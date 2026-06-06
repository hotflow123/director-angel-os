export interface DirectorV1CommandIo {
  readonly fetchImpl?: typeof fetch;
  readonly stdout?: (message: string) => void;
}

interface ParsedDirectorV1Args {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

interface DirectorV1RequestOptions {
  readonly hostUrl: string;
  readonly fetchImpl: typeof fetch;
}

const DEFAULT_HOST_URL = "http://127.0.0.1:3201";
const BOOLEAN_FLAGS = new Set(["json", "no-start"]);

export const DIRECTOR_V1_ACTIONS = new Set([
  "binding",
  "session",
  "task",
  "catalog",
  "learning",
  "capabilities",
]);

export function renderDirectorV1Usage(commandName = "hotflow director"): string {
  return [
    "Director Angel V1 operator surface:",
    `  ${commandName} binding list [--host <url>] [--json]`,
    `  ${commandName} binding create [--binding-id <id>] [--client-id <id>] [--display-name <name>] [--channel <name>] [--host-id <id>] [--agent-id <id>]`,
    `  ${commandName} binding delete --binding-id <id>`,
    `  ${commandName} session list [--json]`,
    `  ${commandName} session create [--binding-id <id>] --peer-id <id> [--title <text>]`,
    `  ${commandName} session messages --session-id <id> --text <text>`,
    `  ${commandName} task list [--json]`,
    `  ${commandName} task submit --session-id <id> --text <text> [--message-id <id>] [--no-start]`,
    `  ${commandName} task status --task-id <id>`,
    `  ${commandName} task cancel --task-id <id>`,
    `  ${commandName} task events --task-id <id>`,
    `  ${commandName} catalog model-adapters [--json]`,
    `  ${commandName} catalog knowledge-packs [--json]`,
    `  ${commandName} learning jobs list [--json]`,
    `  ${commandName} learning jobs create --kind <text|directory|url|query> --source-id <id> [source options]`,
    `  ${commandName} learning jobs run --job-id <id>`,
    `  ${commandName} capabilities [--json]`,
  ].join("\n");
}

export async function runDirectorV1Command(
  args: readonly string[],
  io: DirectorV1CommandIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((message: string) => process.stdout.write(message));
  const parsed = parseDirectorV1Args(args);
  const hostUrl = readStringFlag(parsed, "host") ?? DEFAULT_HOST_URL;
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  const json = readBooleanFlag(parsed, "json");

  if (typeof fetchImpl !== "function") {
    stdout("Director V1 command failed: fetch is not available in this runtime.\n");
    return 1;
  }

  try {
    const result = await dispatchDirectorV1Command(parsed, {
      hostUrl,
      fetchImpl,
    });
    if (typeof result === "string") {
      stdout(result.endsWith("\n") ? result : `${result}\n`);
      return 0;
    }
    stdout(renderDirectorV1Result(result.label, result.body, json));
    return 0;
  } catch (error) {
    stdout(
      `Director V1 command failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function dispatchDirectorV1Command(
  parsed: ParsedDirectorV1Args,
  options: DirectorV1RequestOptions,
): Promise<{ readonly label: string; readonly body: unknown } | string> {
  const [resource, action = "list", detailAction] = parsed.positionals;
  if (!resource || resource === "--help" || resource === "-h") {
    return renderDirectorV1Usage();
  }

  if (resource === "binding") {
    return dispatchBindingCommand(action, parsed, options);
  }
  if (resource === "session") {
    return dispatchSessionCommand(action, parsed, options);
  }
  if (resource === "task") {
    return dispatchTaskCommand(action, parsed, options);
  }
  if (resource === "catalog") {
    return dispatchCatalogCommand(action, options);
  }
  if (resource === "learning") {
    return dispatchLearningCommand(action, detailAction, parsed, options);
  }
  if (resource === "capabilities") {
    return {
      label: "Director V1 capabilities",
      body: await requestJson(options, "GET", "/v1/capabilities"),
    };
  }

  throw new Error(`Unknown Director V1 resource: ${resource}`);
}

async function dispatchBindingCommand(
  action: string,
  parsed: ParsedDirectorV1Args,
  options: DirectorV1RequestOptions,
) {
  if (action === "list") {
    return {
      label: "Director V1 client bindings",
      body: await requestJson(options, "GET", "/v1/client-bindings"),
    };
  }
  if (action === "create") {
    return {
      label: "Director V1 client binding",
      body: await requestJson(
        options,
        "POST",
        "/v1/client-bindings",
        compactObject({
          bindingId: readStringFlag(parsed, "binding-id"),
          clientId: readStringFlag(parsed, "client-id"),
          displayName: readStringFlag(parsed, "display-name"),
          channel: readStringFlag(parsed, "channel"),
          hostId: readStringFlag(parsed, "host-id"),
          agentId: readStringFlag(parsed, "agent-id"),
        }),
      ),
    };
  }
  if (action === "delete") {
    const bindingId = requireFlagOrPositional(parsed, "binding-id", 2);
    await requestText(options, "DELETE", `/v1/client-bindings/${encodeURIComponent(bindingId)}`);
    return { label: "Director V1 client binding deleted", body: { bindingId } };
  }
  throw new Error(`Unknown binding action: ${action}`);
}

async function dispatchSessionCommand(
  action: string,
  parsed: ParsedDirectorV1Args,
  options: DirectorV1RequestOptions,
) {
  if (action === "list") {
    return {
      label: "Director V1 sessions",
      body: await requestJson(options, "GET", "/v1/sessions"),
    };
  }
  if (action === "create") {
    return {
      label: "Director V1 session",
      body: await requestJson(
        options,
        "POST",
        "/v1/sessions",
        compactObject({
          sessionId: readStringFlag(parsed, "session-id"),
          bindingId: readStringFlag(parsed, "binding-id"),
          clientId: readStringFlag(parsed, "client-id"),
          channel: readStringFlag(parsed, "channel"),
          hostId: readStringFlag(parsed, "host-id"),
          agentId: readStringFlag(parsed, "agent-id"),
          peerId: requireFlagOrPositional(parsed, "peer-id", 2),
          title: readStringFlag(parsed, "title"),
        }),
      ),
    };
  }
  if (action === "messages" || action === "message") {
    const sessionId = requireFlagOrPositional(parsed, "session-id", 2);
    return {
      label: "Director V1 session message",
      body: await requestJson(
        options,
        "POST",
        `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
        compactObject({
          messageId: readStringFlag(parsed, "message-id"),
          receivedAtMs: readNumberFlag(parsed, "received-at-ms"),
          text: requireFlagOrPositional(parsed, "text", 3),
        }),
      ),
    };
  }
  throw new Error(`Unknown session action: ${action}`);
}

async function dispatchTaskCommand(
  action: string,
  parsed: ParsedDirectorV1Args,
  options: DirectorV1RequestOptions,
) {
  if (action === "list") {
    return { label: "Director V1 tasks", body: await requestJson(options, "GET", "/v1/tasks") };
  }
  if (action === "submit") {
    return {
      label: "Director V1 task",
      body: await requestJson(
        options,
        "POST",
        "/v1/tasks",
        compactObject({
          sessionId: requireFlagOrPositional(parsed, "session-id", 2),
          messageId: readStringFlag(parsed, "message-id"),
          receivedAtMs: readNumberFlag(parsed, "received-at-ms"),
          text: requireFlagOrPositional(parsed, "text", 3),
          start: !readBooleanFlag(parsed, "no-start"),
        }),
      ),
    };
  }
  if (action === "status") {
    const taskId = requireFlagOrPositional(parsed, "task-id", 2);
    return {
      label: "Director V1 task status",
      body: await requestJson(options, "GET", `/v1/tasks/${encodeURIComponent(taskId)}`),
    };
  }
  if (action === "cancel") {
    const taskId = requireFlagOrPositional(parsed, "task-id", 2);
    return {
      label: "Director V1 task cancelled",
      body: await requestJson(options, "POST", `/v1/tasks/${encodeURIComponent(taskId)}/cancel`),
    };
  }
  if (action === "events") {
    const taskId = requireFlagOrPositional(parsed, "task-id", 2);
    return requestText(options, "GET", `/v1/tasks/${encodeURIComponent(taskId)}/events`);
  }
  throw new Error(`Unknown task action: ${action}`);
}

async function dispatchCatalogCommand(action: string, options: DirectorV1RequestOptions) {
  if (action === "model-adapters") {
    return {
      label: "Director V1 model adapters",
      body: await requestJson(options, "GET", "/v1/catalog/model-adapters"),
    };
  }
  if (action === "knowledge-packs") {
    return {
      label: "Director knowledge packs",
      body: await requestJson(options, "GET", "/v1/catalog/knowledge-packs"),
    };
  }
  throw new Error(`Unknown catalog action: ${action}`);
}

async function dispatchLearningCommand(
  action: string,
  detailAction: string | undefined,
  parsed: ParsedDirectorV1Args,
  options: DirectorV1RequestOptions,
) {
  if (action === "jobs") {
    const jobsAction = detailAction ?? "list";
    if (jobsAction === "list") {
      return {
        label: "Director V1 learning jobs",
        body: await requestJson(options, "GET", "/v1/learning/jobs"),
      };
    }
    if (jobsAction === "create") {
      return {
        label: "Director V1 learning job",
        body: await requestJson(
          options,
          "POST",
          "/v1/learning/jobs",
          createLearningJobBody(parsed),
        ),
      };
    }
    if (jobsAction === "run") {
      const jobId = requireFlagOrPositional(parsed, "job-id", 3);
      return {
        label: "Director V1 learning job run",
        body: await requestJson(
          options,
          "POST",
          `/v1/learning/jobs/${encodeURIComponent(jobId)}/run`,
        ),
      };
    }
    if (jobsAction === "status") {
      const jobId = requireFlagOrPositional(parsed, "job-id", 3);
      return {
        label: "Director V1 learning job status",
        body: await requestJson(options, "GET", `/v1/learning/jobs/${encodeURIComponent(jobId)}`),
      };
    }
    if (jobsAction === "delete") {
      const jobId = requireFlagOrPositional(parsed, "job-id", 3);
      await requestText(options, "DELETE", `/v1/learning/jobs/${encodeURIComponent(jobId)}`);
      return { label: "Director V1 learning job deleted", body: { jobId } };
    }
    throw new Error(`Unknown learning jobs action: ${jobsAction}`);
  }
  if (action === "run") {
    const jobId = requireFlagOrPositional(parsed, "job-id", 2);
    return {
      label: "Director V1 learning job run",
      body: await requestJson(
        options,
        "POST",
        `/v1/learning/jobs/${encodeURIComponent(jobId)}/run`,
      ),
    };
  }
  throw new Error(`Unknown learning action: ${action}`);
}

function createLearningJobBody(parsed: ParsedDirectorV1Args): Record<string, unknown> {
  const kind = requireFlagOrPositional(parsed, "kind", 3);
  const sourceId = requireFlagOrPositional(parsed, "source-id", 4);
  const common = compactObject({
    jobId: readStringFlag(parsed, "job-id"),
    kind,
    sourceId,
    privacy: readStringFlag(parsed, "privacy"),
    nowMs: readNumberFlag(parsed, "now-ms"),
  });
  if (kind === "text") {
    return compactObject({
      ...common,
      texts: [
        compactObject({
          title: readStringFlag(parsed, "title"),
          content: requireFlagOrPositional(parsed, "text", 5),
          sourceRef: readStringFlag(parsed, "source-ref"),
          contentType: readStringFlag(parsed, "content-type"),
        }),
      ],
    });
  }
  if (kind === "directory") {
    return compactObject({
      ...common,
      directory: requireFlagOrPositional(parsed, "directory", 5),
      maxDepth: readNumberFlag(parsed, "max-depth"),
      maxFiles: readNumberFlag(parsed, "max-files"),
      maxBytesPerFile: readNumberFlag(parsed, "max-bytes-per-file"),
    });
  }
  if (kind === "url") {
    return compactObject({
      ...common,
      urls: [requireFlagOrPositional(parsed, "url", 5)],
      maxBytesPerPage: readNumberFlag(parsed, "max-bytes-per-page"),
    });
  }
  if (kind === "query") {
    return compactObject({
      ...common,
      queries: [requireFlagOrPositional(parsed, "query", 5)],
      maxResultsPerQuery:
        readNumberFlag(parsed, "max-results-per-query") ?? readNumberFlag(parsed, "max-results"),
      maxBytesPerPage: readNumberFlag(parsed, "max-bytes-per-page"),
    });
  }
  throw new Error("Learning job --kind must be one of: text, directory, url, query.");
}

async function requestJson(
  options: DirectorV1RequestOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await options.fetchImpl(buildUrl(options.hostUrl, path), {
    method,
    headers: createDirectorHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(readErrorMessage(text) ?? `${method} ${path} failed (${response.status})`);
  }
  return text.trim().length === 0 ? {} : (JSON.parse(text) as unknown);
}

async function requestText(
  options: DirectorV1RequestOptions,
  method: string,
  path: string,
): Promise<string> {
  const response = await options.fetchImpl(buildUrl(options.hostUrl, path), {
    method,
    headers: createDirectorHostApiRequestHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(readErrorMessage(text) ?? `${method} ${path} failed (${response.status})`);
  }
  return text;
}

function buildUrl(hostUrl: string, path: string): string {
  return new URL(path, `${hostUrl.replace(/\/+$/u, "")}/`).toString();
}

function createDirectorHostApiRequestHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const token = readDirectorHostApiBearerToken();
  return token === undefined
    ? headers
    : {
        ...headers,
        authorization: `Bearer ${token}`,
      };
}

function readDirectorHostApiBearerToken(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const token = process.env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

function parseDirectorV1Args(args: readonly string[]): ParsedDirectorV1Args {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined || token.length === 0) {
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}.`);
    }
    flags.set(name, value);
    index += 1;
  }
  return { positionals, flags };
}

function readStringFlag(parsed: ParsedDirectorV1Args, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumberFlag(parsed: ParsedDirectorV1Args, name: string): number | undefined {
  const value = readStringFlag(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`--${name} must be a number.`);
  }
  return parsedNumber;
}

function readBooleanFlag(parsed: ParsedDirectorV1Args, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function requireFlagOrPositional(
  parsed: ParsedDirectorV1Args,
  flagName: string,
  positionalIndex: number,
): string {
  const value = readStringFlag(parsed, flagName) ?? parsed.positionals[positionalIndex];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required --${flagName}.`);
  }
  return value.trim();
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function renderDirectorV1Result(label: string, body: unknown, json: boolean): string {
  if (json) {
    return `${JSON.stringify(body, null, 2)}\n`;
  }
  return `${label}:\n${JSON.stringify(body, null, 2)}\n`;
}

function readErrorMessage(text: string): string | undefined {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.message === "string") {
        return record.message;
      }
      if (typeof record.error === "string") {
        return record.error;
      }
    }
  } catch {
    return text;
  }
  return text;
}
