import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";

export interface ConversationRuntimeToolSearchInput {
  readonly query: string;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly maxResults?: number;
}

export interface ConversationRuntimeToolSearchMatch {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly reason: string;
}

export type ConversationRuntimeToolSearchExecutor = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

const TOOL_SEARCH_NAME = "tool.search";
const DEFAULT_TOOL_SEARCH_MAX_RESULTS = 5;
const MAX_TOOL_SEARCH_RESULTS = 20;

export function createToolSearchTool(): ConversationRuntimeModelToolDefinition {
  return {
    name: TOOL_SEARCH_NAME,
    description:
      "Search or select available runtime tools by name, capability, description, or MCP metadata. Use this when many tools exist and you need to discover the right Skill/tool/MCP entry before calling it. Supports query='select:tool_a,tool_b' for direct selection.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword search, or select:<tool_name>[,<tool_name>] to load exact tools.",
        },
        max_results: {
          type: "integer",
          description: "Maximum results, default 5.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    metadata: {
      capability: "tool.discovery",
      source: "built-in",
      observationContract: "status-summary-next_actions",
    },
  };
}

export function createToolSearchExecutor(input: {
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
}): ConversationRuntimeToolSearchExecutor {
  return (executionInput) => {
    const query = readRequiredString(executionInput.call.args, "query");
    if (query === null) {
      return createToolSearchResult({
        callId: executionInput.call.id,
        toolName: executionInput.call.name,
        ok: false,
        output: {
          status: "error",
          summary: "tool.search requires a non-empty query.",
          query: "",
          results: [],
          failures: ["missing query"],
          next_actions: ["retry tool.search with a keyword or select:<tool_name>"],
        },
        error: "missing query",
      });
    }
    const matches = searchConversationRuntimeTools({
      query,
      tools: input.tools,
      maxResults: readMaxResults(executionInput.call.args),
    });
    return createToolSearchResult({
      callId: executionInput.call.id,
      toolName: executionInput.call.name,
      ok: true,
      output: {
        status: matches.length === 0 ? "warning" : "success",
        summary:
          matches.length === 0
            ? `No matching tool found for "${query}".`
            : `Found ${matches.length} matching tool(s) for "${query}".`,
        query,
        results: matches,
        result_count: matches.length,
        next_actions:
          matches.length === 0
            ? ["check whether the MCP/Skill/tool is installed and enabled"]
            : ["call the best matching tool when it is needed for the user's request"],
      },
    });
  };
}

export function searchConversationRuntimeTools(
  input: ConversationRuntimeToolSearchInput,
): readonly ConversationRuntimeToolSearchMatch[] {
  const maxResults = clampMaxResults(input.maxResults);
  const query = input.query.trim();
  if (query.length === 0 || maxResults <= 0) {
    return [];
  }

  const tools = input.tools.filter((tool) => tool.name !== TOOL_SEARCH_NAME);
  const selected = parseSelectQuery(query);
  if (selected.length > 0) {
    return selected
      .flatMap((name) => {
        const tool = findToolByName(tools, name);
        return tool === undefined
          ? []
          : [createToolSearchMatch(tool, 100, `selected ${tool.name}`)];
      })
      .slice(0, maxResults);
  }

  const terms = splitToolSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const requiredTerms = terms
    .filter((term) => term.startsWith("+") && term.length > 1)
    .map((term) => term.slice(1));
  const optionalTerms = terms.filter((term) => !term.startsWith("+"));
  const scoringTerms = requiredTerms.length > 0 ? [...requiredTerms, ...optionalTerms] : terms;
  const rawQuery = query.toLowerCase();

  return tools
    .map((tool) => scoreToolSearchMatch(tool, scoringTerms, requiredTerms, rawQuery))
    .filter((match): match is ConversationRuntimeToolSearchMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, maxResults);
}

function scoreToolSearchMatch(
  tool: ConversationRuntimeModelToolDefinition,
  terms: readonly string[],
  requiredTerms: readonly string[],
  rawQuery: string,
): ConversationRuntimeToolSearchMatch | null {
  const searchable = buildSearchableToolText(tool);
  if (
    requiredTerms.length > 0 &&
    !requiredTerms.every((term) => searchable.normalized.includes(term))
  ) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];
  const nameParts = splitToolNameParts(tool.name);
  for (const term of terms) {
    if (nameParts.includes(term)) {
      score += 12;
      reasons.push(term);
    } else if (nameParts.some((part) => part.includes(term))) {
      score += 7;
      reasons.push(term);
    } else if (searchable.metadata.includes(term)) {
      score += 6;
      reasons.push(term);
    } else if (searchable.description.includes(term)) {
      score += 3;
      reasons.push(term);
    } else if (searchable.normalized.includes(term)) {
      score += 1;
      reasons.push(term);
    }
  }

  const related = scoreRelatedToolSearchMatch(tool, rawQuery, searchable);
  if (related !== null) {
    score += related.score;
    reasons.push(related.reason);
  }
  if (score <= 0) {
    return null;
  }
  return createToolSearchMatch(
    tool,
    score,
    reasons.length === 0 ? "matched tool metadata" : `matched ${dedupeStrings(reasons).join(", ")}`,
  );
}

function scoreRelatedToolSearchMatch(
  tool: ConversationRuntimeModelToolDefinition,
  rawQuery: string,
  searchable: ReturnType<typeof buildSearchableToolText>,
): { readonly score: number; readonly reason: string } | null {
  const isComfyOrWorkflow =
    searchable.name.includes("comfy") ||
    searchable.metadata.includes("comfy") ||
    searchable.description.includes("workflow") ||
    searchable.description.includes("prompt");
  if (!isComfyOrWorkflow) {
    return null;
  }
  if (rawQuery.includes("image")) {
    return {
      score: tool.name.startsWith("mcp__") ? 4 : 2,
      reason: "related image workflow tool",
    };
  }
  if (rawQuery.includes("video")) {
    return {
      score: tool.name.startsWith("mcp__") ? 4 : 2,
      reason: "related video workflow tool",
    };
  }
  return null;
}

function buildSearchableToolText(tool: ConversationRuntimeModelToolDefinition) {
  const metadata = Object.entries(tool.metadata ?? {})
    .flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [key, String(value)]
        : [key],
    )
    .join(" ")
    .toLowerCase();
  const description = tool.description.toLowerCase();
  const name = tool.name.toLowerCase();
  return {
    name,
    description,
    metadata,
    normalized: `${name} ${description} ${metadata}`,
  };
}

function createToolSearchMatch(
  tool: ConversationRuntimeModelToolDefinition,
  score: number,
  reason: string,
): ConversationRuntimeToolSearchMatch {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.readOnly,
    ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
    score,
    reason,
  };
}

function createToolSearchResult(input: {
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
    content: formatToolSearchObservation(input.output),
    output: input.output,
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      observationFormat: "director.tool-search-observation.v1",
    },
  };
}

function formatToolSearchObservation(output: Readonly<Record<string, unknown>>): string {
  const lines = [
    `status: ${String(output.status ?? "error")}`,
    `summary: ${String(output.summary ?? "")}`,
  ];
  const query = output.query;
  if (typeof query === "string" && query.length > 0) {
    lines.push(`query: ${query}`);
  }
  if (typeof output.result_count === "number") {
    lines.push(`result_count: ${output.result_count}`);
  }
  const results = Array.isArray(output.results) ? output.results : [];
  if (results.length > 0) {
    lines.push(
      `results: ${results
        .map((result) =>
          isRecord(result)
            ? [
                readString(result, "name") ?? "",
                readString(result, "reason") ?? "",
                readBooleanValue(result, "readOnly") === undefined
                  ? ""
                  : `readOnly=${String(readBooleanValue(result, "readOnly"))}`,
              ]
                .filter((part) => part.length > 0)
                .join(" | ")
            : "",
        )
        .filter((line) => line.length > 0)
        .join("\n")}`,
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

function parseSelectQuery(query: string): readonly string[] {
  const match = query.match(/^select:(.+)$/iu);
  if (match?.[1] === undefined) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitToolSearchTerms(query: string): readonly string[] {
  return dedupeStrings(
    query
      .toLowerCase()
      .split(/[^a-z0-9_+\-.]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length > 0),
  );
}

function splitToolNameParts(name: string): readonly string[] {
  return dedupeStrings(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

function findToolByName(
  tools: readonly ConversationRuntimeModelToolDefinition[],
  name: string,
): ConversationRuntimeModelToolDefinition | undefined {
  return tools.find((tool) => tool.name === name || tool.name.toLowerCase() === name.toLowerCase());
}

function clampMaxResults(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TOOL_SEARCH_MAX_RESULTS;
  }
  return Math.max(0, Math.min(Math.trunc(value), MAX_TOOL_SEARCH_RESULTS));
}

function readMaxResults(args: Readonly<Record<string, unknown>>): number {
  const value = args.max_results ?? args.maxResults;
  return clampMaxResults(typeof value === "number" ? value : undefined);
}

function readRequiredString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}

function readBooleanValue(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const item = value[key];
  return typeof item === "boolean" ? item : undefined;
}
