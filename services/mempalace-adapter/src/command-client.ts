import { spawnSync } from "node:child_process";
import {
  type AgentOsSandboxCommandRunRequest,
  admitAgentOsSandboxExecutionSync,
  createAgentOsHostSandboxBackendAdapter,
  createAgentOsSandboxBackendRegistry,
  executeAgentOsSandboxCommandSync,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";

import {
  type CommandExecutionResult,
  MEMPALACE_UNREACHABLE_REASON,
  type MempalaceAdapterConfig,
  type MempalaceCommandExecutor,
  type MempalaceCommandRequest,
  type MempalaceCommandResult,
} from "./types.js";

function toDegraded(reason: string, message: string) {
  return {
    reason,
    message,
  } as const;
}

export function defaultMempalaceCommandExecutor(context: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly inputJson: string;
}): CommandExecutionResult {
  const cwd = context.cwd ?? process.cwd();
  const operationId = `mempalace:${context.args.join(" ") || context.command}`;
  const registry = createAgentOsSandboxBackendRegistry({
    enabledBackends: ["host"],
    adapters: [
      createAgentOsHostSandboxBackendAdapter({
        allowHostExecution: true,
        allowedCommandPatterns: [
          {
            executable: context.command,
            argv: context.args,
            operationId,
          },
        ],
        networkPolicy: "none",
        commandRunner: (request: AgentOsSandboxCommandRunRequest) => {
          const result = spawnSync(request.executable, [...request.argv], {
            encoding: "utf8",
            timeout: context.timeoutMs,
            maxBuffer: 1024 * 1024,
            ...(request.cwd ? { cwd: request.cwd } : {}),
            input: context.inputJson,
          });
          return {
            exitCode: result.status ?? 1,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            metadata: {
              signal: result.signal,
              timedOut: result.signal === "SIGTERM" && result.status === null,
              ...(result.error instanceof Error ? { errorMessage: result.error.message } : {}),
            },
          };
        },
      }),
    ],
  });
  const plan = planAgentOsSandboxExecution({
    toolName: "mempalace",
    operationId,
    providerId: "mempalace",
    cwd,
    command: context.command,
    argv: context.args,
    requestedNetworkPolicy: "none",
    preflight: {
      verdict: "allow",
      sandboxMode: "host",
      checkedAt: new Date().toISOString(),
      providerId: "mempalace",
      reason:
        "Mempalace adapter command execution is routed through Agent OS host sandbox backend.",
    },
    policy: {
      enabledBackends: ["host"],
      readableRoots: [cwd],
      writableRoots: [cwd],
      networkPolicy: "none",
    },
  });
  const admission = admitAgentOsSandboxExecutionSync(plan, { registry });
  const execution = executeAgentOsSandboxCommandSync(plan, admission, { registry });
  const metadata = readRecord(execution.metadata);
  const errorMessage =
    typeof metadata?.errorMessage === "string" && metadata.errorMessage.length > 0
      ? metadata.errorMessage
      : undefined;
  const signal = readProcessSignal(metadata?.signal);

  return {
    status: execution.exitCode ?? null,
    signal,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? execution.reason ?? "",
    timedOut: metadata?.timedOut === true,
    ...(errorMessage === undefined ? {} : { error: new Error(errorMessage) }),
    ...(execution.evidence === undefined
      ? {}
      : { agentOsSandboxCommandExecution: execution.evidence }),
  };
}

function toDiagnostics(execution: CommandExecutionResult): Readonly<Record<string, unknown>> {
  return {
    status: execution.status,
    signal: execution.signal,
    timedOut: execution.timedOut,
    stderr: execution.stderr.trim(),
    ...(execution.agentOsSandboxCommandExecution === undefined
      ? {}
      : { agentOsSandboxCommandExecution: execution.agentOsSandboxCommandExecution }),
  };
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readProcessSignal(value: unknown): NodeJS.Signals | null {
  return typeof value === "string" ? (value as NodeJS.Signals) : null;
}

export function runMempalaceCommandSync(
  config: MempalaceAdapterConfig,
  request: MempalaceCommandRequest,
  runCommand: MempalaceCommandExecutor = defaultMempalaceCommandExecutor,
): MempalaceCommandResult {
  if (!config.command) {
    return {
      ok: false,
      degraded: toDegraded(MEMPALACE_UNREACHABLE_REASON, "Mempalace command is not configured."),
      diagnostics: {
        mode: config.mode,
        configured: config.configured,
      },
    };
  }

  const execution = runCommand({
    command: config.command,
    args: config.commandArgs,
    ...(config.workingDirectory ? { cwd: config.workingDirectory } : {}),
    timeoutMs: config.timeoutMs,
    inputJson: JSON.stringify(request),
  });
  const diagnostics = toDiagnostics(execution);

  if (execution.error) {
    return {
      ok: false,
      degraded: toDegraded(MEMPALACE_UNREACHABLE_REASON, execution.error.message),
      diagnostics,
    };
  }

  if (execution.status !== 0) {
    const message =
      execution.stderr.trim() || `Mempalace command exited with status ${execution.status}.`;
    return {
      ok: false,
      degraded: toDegraded(MEMPALACE_UNREACHABLE_REASON, message),
      diagnostics,
    };
  }

  const stdout = execution.stdout.trim();
  if (stdout.length === 0) {
    return {
      ok: false,
      degraded: toDegraded(
        MEMPALACE_UNREACHABLE_REASON,
        "Mempalace command returned empty stdout.",
      ),
      diagnostics,
    };
  }

  try {
    const payload = JSON.parse(stdout);
    return {
      ok: true,
      payload,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON payload";
    return {
      ok: false,
      degraded: toDegraded(MEMPALACE_UNREACHABLE_REASON, `Invalid JSON response: ${message}`),
      diagnostics,
    };
  }
}
