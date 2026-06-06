import {
  DEFAULT_MEMPALACE_MODE,
  DEFAULT_MEMPALACE_RESULTS_LIMIT,
  DEFAULT_MEMPALACE_TIMEOUT_MS,
  type LoadMempalaceAdapterConfigInput,
  type MempalaceAdapterConfig,
  type MempalaceAdapterMode,
} from "./types.js";

function readEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseMode(rawMode: string | undefined): {
  readonly mode: MempalaceAdapterMode;
  readonly issue?: string;
} {
  if (!rawMode) {
    return { mode: DEFAULT_MEMPALACE_MODE };
  }
  if (rawMode === "disabled" || rawMode === "optional" || rawMode === "primary") {
    return { mode: rawMode };
  }
  return {
    mode: DEFAULT_MEMPALACE_MODE,
    issue: `Invalid HOTFLOW_MEMPALACE_MODE "${rawMode}", fallback to "${DEFAULT_MEMPALACE_MODE}".`,
  };
}

function parseCommandArgs(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      return trimmed.split(/\s+/g);
    }
  }
  return trimmed.split(/\s+/g);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadMempalaceAdapterConfig(
  input: LoadMempalaceAdapterConfigInput = {},
): MempalaceAdapterConfig {
  const env = input.env ?? process.env;
  const issues: string[] = [];
  const overrides = input.overrides;

  const parsedMode = parseMode(overrides?.mode ?? readEnvString(env, "HOTFLOW_MEMPALACE_MODE"));
  if (parsedMode.issue) {
    issues.push(parsedMode.issue);
  }

  const command = normalizeOptionalString(
    overrides?.command ?? readEnvString(env, "HOTFLOW_MEMPALACE_COMMAND"),
  );
  const palacePath = normalizeOptionalString(
    overrides?.palacePath ??
      readEnvString(env, "HOTFLOW_MEMPALACE_PALACE_PATH") ??
      readEnvString(env, "HOTFLOW_MEMPALACE_PATH"),
  );
  const workingDirectory = normalizeOptionalString(
    overrides?.workingDirectory ?? readEnvString(env, "HOTFLOW_MEMPALACE_WORKDIR"),
  );
  const wing = normalizeOptionalString(
    overrides?.wing ?? readEnvString(env, "HOTFLOW_MEMPALACE_WING"),
  );
  const room = normalizeOptionalString(
    overrides?.room ?? readEnvString(env, "HOTFLOW_MEMPALACE_ROOM"),
  );

  const timeoutMs =
    overrides?.timeoutMs ??
    parsePositiveInteger(
      readEnvString(env, "HOTFLOW_MEMPALACE_TIMEOUT_MS"),
      DEFAULT_MEMPALACE_TIMEOUT_MS,
    );
  const nResults =
    overrides?.nResults ??
    parsePositiveInteger(
      readEnvString(env, "HOTFLOW_MEMPALACE_N_RESULTS"),
      DEFAULT_MEMPALACE_RESULTS_LIMIT,
    );
  const commandArgs =
    overrides?.commandArgs ??
    parseCommandArgs(readEnvString(env, "HOTFLOW_MEMPALACE_COMMAND_ARGS"));

  const requiresBackend = parsedMode.mode === "optional" || parsedMode.mode === "primary";
  const configured = requiresBackend && Boolean(command) && Boolean(palacePath);
  if (requiresBackend) {
    if (!command) {
      issues.push(`Missing HOTFLOW_MEMPALACE_COMMAND in ${parsedMode.mode} mode.`);
    }
    if (!palacePath) {
      issues.push(`Missing HOTFLOW_MEMPALACE_PALACE_PATH in ${parsedMode.mode} mode.`);
    }
  }

  return {
    mode: parsedMode.mode,
    ...(command ? { command } : {}),
    commandArgs,
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(palacePath ? { palacePath } : {}),
    ...(wing ? { wing } : {}),
    ...(room ? { room } : {}),
    timeoutMs,
    nResults,
    configured,
    degradeOnFailure: true,
    issues,
  };
}
