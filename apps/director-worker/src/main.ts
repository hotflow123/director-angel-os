import { pathToFileURL } from "node:url";

import { type DirectorWorkerRunOnceResult, bootstrapDirectorWorker } from "./bootstrap.js";

export interface DirectorWorkerCliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface DirectorWorkerCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly io?: DirectorWorkerCliIo;
}

export interface DirectorWorkerRunOnceOptions {
  readonly env?: NodeJS.ProcessEnv;
}

interface ParsedRunOnceCommand {
  readonly type: "run-once";
  readonly runId: string;
  readonly workerId: string;
}

type ParsedCommand = ParsedRunOnceCommand | { readonly type: "help" };

const HELP_TEXT = ["Usage:", "  director-worker run-once --run-id <id> [--worker-id <id>]"].join(
  "\n",
);

export async function runDirectorWorkerOnce(
  input: {
    readonly runId: string;
    readonly workerId: string;
  },
  options: DirectorWorkerRunOnceOptions = {},
): Promise<DirectorWorkerRunOnceResult> {
  const runtime = bootstrapDirectorWorker({
    ...(options.env ? { env: options.env } : {}),
  });

  try {
    return await runtime.runOnce({
      runId: input.runId,
      workerId: input.workerId,
    });
  } finally {
    runtime.close();
  }
}

export async function runDirectorWorkerCli(
  argv: readonly string[],
  options: DirectorWorkerCliOptions = {},
): Promise<number> {
  const io = options.io ?? {
    stdout(message: string) {
      process.stdout.write(message);
    },
    stderr(message: string) {
      process.stderr.write(message);
    },
  };

  const parsed = parseCommand(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n`);
    io.stderr(`${HELP_TEXT}\n`);
    return 1;
  }

  if (parsed.value.type === "help") {
    io.stdout(`${HELP_TEXT}\n`);
    return 0;
  }

  try {
    const result = await runDirectorWorkerOnce(
      {
        runId: parsed.value.runId,
        workerId: parsed.value.workerId,
      },
      {
        ...(options.env ? { env: options.env } : {}),
      },
    );
    io.stdout(
      `${JSON.stringify(
        {
          runId: result.run.runId,
          status: result.run.status,
          executedAssignments: result.executedAssignments,
          reportId: result.report.reportId,
          flags: result.report.flags,
          summary: result.report.summary,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${normalizeError(error)}\n`);
    return 1;
  }
}

if (isExecutedAsScript()) {
  void runDirectorWorkerCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function parseCommand(argv: readonly string[]): ParseResult<ParsedCommand> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalizedArgv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { ok: true, value: { type: "help" } };
  }

  if (command !== "run-once") {
    return { ok: false, error: `Unknown director-worker command: ${command}` };
  }

  let runId: string | undefined;
  let workerId = "director-worker";

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (token === "--run-id") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "Missing value for --run-id." };
      }
      runId = value;
      index += 1;
      continue;
    }

    if (token === "--worker-id") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!runId) {
    return { ok: false, error: "Missing --run-id <id>." };
  }

  return {
    ok: true,
    value: {
      type: "run-once",
      runId,
      workerId,
    },
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isExecutedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };
