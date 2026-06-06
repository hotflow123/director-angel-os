import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";

export interface ConversationRuntimeXSearchProviderInput {
  readonly query: string;
  readonly allowedXHandles?: readonly string[];
  readonly excludedXHandles?: readonly string[];
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly enableImageUnderstanding?: boolean;
  readonly enableVideoUnderstanding?: boolean;
  readonly maxResults: number;
  readonly reason?: string;
}

export interface ConversationRuntimeXSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly source?: string;
}

export interface ConversationRuntimeXSearchProviderOutput {
  readonly query: string;
  readonly provider?: string;
  readonly results: readonly ConversationRuntimeXSearchResult[];
  readonly failures?: readonly string[];
  readonly blocked?: boolean;
  readonly nextActions?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeXSearchProvider = (
  input: ConversationRuntimeXSearchProviderInput,
) => Promise<ConversationRuntimeXSearchProviderOutput> | ConversationRuntimeXSearchProviderOutput;

export interface CreateBuiltinXToolExecutorsOptions {
  readonly search?: ConversationRuntimeXSearchProvider;
}

export type ConversationRuntimeBuiltinXToolExecutor = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

export function createBuiltinXTools(): ConversationRuntimeModelToolDefinition[] {
  return [
    {
      name: "x_search",
      description:
        "Search X/Twitter for current posts, threads, or creator discussions. Use this when the user says 推特, Twitter, X, X/Twitter, or asks to continue a research task on social posts. Returns source candidates only; do not claim that full linked content was read from search results alone.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "X/Twitter search query string.",
          },
          allowed_x_handles: {
            type: "array",
            items: { type: "string" },
            description: "Only include posts from these X handles.",
          },
          excluded_x_handles: {
            type: "array",
            items: { type: "string" },
            description: "Exclude posts from these X handles.",
          },
          from_date: {
            type: "string",
            description: "Only include posts on or after this date (YYYY-MM-DD).",
          },
          to_date: {
            type: "string",
            description: "Only include posts on or before this date (YYYY-MM-DD).",
          },
          enable_image_understanding: {
            type: "boolean",
            description:
              "Allow the configured provider to inspect images attached to matching posts.",
          },
          enable_video_understanding: {
            type: "boolean",
            description:
              "Allow the configured provider to inspect videos attached to matching posts.",
          },
          reason: {
            type: "string",
            description: "Short reason for selecting X/Twitter search.",
          },
          max_results: {
            type: "integer",
            description: "Maximum result count, default 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      metadata: {
        capability: "x.search",
        source: "built-in",
        providerFamily: "xai",
        observationContract: "status-summary-next_actions",
      },
    },
  ];
}

export function createBuiltinXToolExecutors(
  options: CreateBuiltinXToolExecutorsOptions = {},
): ReadonlyMap<string, ConversationRuntimeBuiltinXToolExecutor> {
  return new Map<string, ConversationRuntimeBuiltinXToolExecutor>([
    [
      "x_search",
      async (input) => {
        const search = options.search;
        return executeXSearchTool({
          input,
          ...(search === undefined ? {} : { search }),
        });
      },
    ],
  ]);
}

async function executeXSearchTool(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly search?: ConversationRuntimeXSearchProvider;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const query = readRequiredString(input.input.call.args, "query");
  if (query === null) {
    return createBuiltinXToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "x_search requires a non-empty query.",
        query: "",
        provider: "x-twitter",
        results: [],
        failures: ["missing query"],
        next_actions: ["retry x_search with a non-empty query"],
      },
      error: "missing query",
    });
  }
  const maxResults = readMaxResults(input.input.call.args);
  if (input.search === undefined) {
    return createBuiltinXToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "needs-auth",
        summary:
          "x_search needs a configured X/Twitter search provider before it can search live posts.",
        query,
        provider: "x-twitter",
        results: [],
        failures: ["missing X search provider or API key"],
        next_actions: [
          "configure XAI_API_KEY or an MCP/provider that exposes x_search",
          "use web_search as a fallback for public web results",
        ],
      },
      error: "x search provider unavailable",
    });
  }

  try {
    const allowedXHandles = readOptionalStringArray(input.input.call.args, "allowed_x_handles");
    const excludedXHandles = readOptionalStringArray(input.input.call.args, "excluded_x_handles");
    const fromDate = readOptionalString(input.input.call.args, "from_date");
    const toDate = readOptionalString(input.input.call.args, "to_date");
    const reason = readOptionalString(input.input.call.args, "reason");
    const searchResult = await input.search({
      query,
      ...(allowedXHandles === undefined ? {} : { allowedXHandles }),
      ...(excludedXHandles === undefined ? {} : { excludedXHandles }),
      ...(fromDate === undefined ? {} : { fromDate }),
      ...(toDate === undefined ? {} : { toDate }),
      enableImageUnderstanding: input.input.call.args.enable_image_understanding === true,
      enableVideoUnderstanding: input.input.call.args.enable_video_understanding === true,
      maxResults,
      ...(reason === undefined ? {} : { reason }),
    });
    const results = searchResult.results.slice(0, maxResults).map(normalizeXSearchResult);
    return createBuiltinXToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: true,
      output: {
        status:
          searchResult.blocked === true ? "blocked" : results.length === 0 ? "warning" : "success",
        summary:
          searchResult.blocked === true
            ? `X/Twitter search needs verification or provider attention for "${query}".`
            : results.length === 0
              ? `No X/Twitter results found for "${query}".`
              : `Found ${results.length} X/Twitter candidate(s) for "${query}".`,
        query: searchResult.query,
        provider: searchResult.provider ?? "x-twitter",
        results,
        failures: [...(searchResult.failures ?? [])],
        next_actions:
          searchResult.nextActions ??
          (searchResult.blocked === true
            ? ["open X/Twitter or provider console for operator verification"]
            : ["extract promising URLs with web_extract or inspect via browser tools"]),
        ...(searchResult.metadata === undefined ? {} : { metadata: searchResult.metadata }),
      },
    });
  } catch (error) {
    return createBuiltinXToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: `X/Twitter search failed for "${query}".`,
        query,
        provider: "x-twitter",
        results: [],
        failures: [error instanceof Error ? error.message : String(error)],
        next_actions: ["retry later or use a configured MCP/search provider"],
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createBuiltinXToolResult(input: {
  readonly callId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly output: Readonly<Record<string, unknown>>;
  readonly error?: string;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.callId,
    toolName: input.toolName,
    ok: input.ok,
    content: formatXToolObservation(input.output),
    output: input.output,
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      observationFormat: "director.tool-observation.v1",
    },
  };
}

function formatXToolObservation(output: Readonly<Record<string, unknown>>): string {
  const lines = [
    `status: ${String(output.status ?? "error")}`,
    `summary: ${String(output.summary ?? "")}`,
  ];
  if (typeof output.query === "string") {
    lines.push(`query: ${output.query}`);
  }
  if (typeof output.provider === "string" && output.provider.length > 0) {
    lines.push(`provider: ${output.provider}`);
  }
  const results = Array.isArray(output.results) ? output.results : [];
  lines.push(`result_count: ${results.length}`);
  for (const [index, result] of results.entries()) {
    if (!isRecord(result)) {
      continue;
    }
    const title = readString(result, "title") ?? "Untitled";
    const url = readString(result, "url") ?? "";
    const snippet = readString(result, "snippet");
    const source = readString(result, "source");
    lines.push(
      [
        `result_${index + 1}: ${title}`,
        ...(url.length === 0 ? [] : [`url=${url}`]),
        ...(source === undefined ? [] : [`source=${source}`]),
        ...(snippet === undefined ? [] : [`snippet=${snippet}`]),
      ].join(" | "),
    );
  }
  const failures = Array.isArray(output.failures)
    ? output.failures.filter((item): item is string => typeof item === "string")
    : [];
  if (failures.length > 0) {
    lines.push(`failures: ${failures.join("; ")}`);
  }
  const nextActions = Array.isArray(output.next_actions)
    ? output.next_actions.filter((item): item is string => typeof item === "string")
    : [];
  if (nextActions.length > 0) {
    lines.push(`next_actions: ${nextActions.join("; ")}`);
  }
  return lines.join("\n");
}

function readRequiredString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalStringArray(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : items;
}

function readMaxResults(args: Readonly<Record<string, unknown>>): number {
  const value = args.max_results ?? args.maxResults;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function normalizeXSearchResult(
  result: ConversationRuntimeXSearchResult,
): ConversationRuntimeXSearchResult {
  return {
    title: result.title.trim() || result.url,
    url: result.url,
    ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
    source: result.source ?? "x-twitter",
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}
