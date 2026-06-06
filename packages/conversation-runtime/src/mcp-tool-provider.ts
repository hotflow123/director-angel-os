import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";

/**
 * Claude Code compatible MCP tool name separator.
 *
 * Reference behavior copied from Claude Code:
 * - MCP tools are exposed as mcp__server__tool.
 * - Built-ins keep their own names and win conflicts.
 * - Permission rules can target the fully qualified MCP name.
 */
const MCP_NAME_SEPARATOR = "__";
const MAX_MCP_DESCRIPTION_LENGTH = 2048;

export interface ConversationRuntimeMcpToolSource {
  readonly serverName: string;
  readonly toolName: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
  readonly enabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMcpToolProvider {
  readonly listTools: () =>
    | Promise<readonly ConversationRuntimeMcpToolSource[]>
    | readonly ConversationRuntimeMcpToolSource[];
}

export interface ConversationRuntimeMcpToolCallInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly callId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMcpToolCallOutput {
  readonly ok: boolean;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeMcpToolCallPort = (
  input: ConversationRuntimeMcpToolCallInput,
) => Promise<ConversationRuntimeMcpToolCallOutput> | ConversationRuntimeMcpToolCallOutput;

export type ConversationRuntimeMcpToolExecutor = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

export function normalizeNameForMCP(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `mcp${MCP_NAME_SEPARATOR}${normalizeNameForMCP(serverName)}${MCP_NAME_SEPARATOR}${normalizeNameForMCP(toolName)}`;
}

export function parseMcpToolName(
  value: string,
): { readonly serverName: string; readonly toolName: string } | null {
  const parts = value.split(MCP_NAME_SEPARATOR);
  const [mcpPart, serverName, ...toolNameParts] = parts;
  if (mcpPart !== "mcp" || serverName === undefined || serverName.length === 0) {
    return null;
  }
  const toolName = toolNameParts.join(MCP_NAME_SEPARATOR);
  if (toolName.length === 0) {
    return null;
  }
  return { serverName, toolName };
}

export async function createConversationRuntimeMcpTools(input: {
  readonly provider?: ConversationRuntimeMcpToolProvider;
  readonly reservedToolNames?: readonly string[];
}): Promise<readonly ConversationRuntimeModelToolDefinition[]> {
  if (input.provider === undefined) {
    return [];
  }
  const reserved = new Set(input.reservedToolNames ?? []);
  const discovered = await input.provider.listTools();
  const tools: ConversationRuntimeModelToolDefinition[] = [];
  const seen = new Set<string>();
  for (const source of discovered) {
    if (source.enabled === false) {
      continue;
    }
    const name = buildMcpToolName(source.serverName, source.toolName);
    if (reserved.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const destructive = source.destructive === true;
    const readOnly = source.readOnly === true && destructive !== true;
    tools.push({
      name,
      description: truncateMcpDescription(source.description ?? ""),
      readOnly,
      ...(source.inputSchema === undefined ? {} : { inputSchema: source.inputSchema }),
      metadata: {
        ...(source.metadata ?? {}),
        source: "mcp",
        capability: "mcp.tool",
        serverName: source.serverName,
        toolName: source.toolName,
        fullyQualifiedName: name,
        risk: readOnly ? "mcp-read" : "mcp-execution",
        openWorld: source.openWorld === true,
        destructive,
        requiresApproval: !readOnly,
      },
    });
  }
  return tools;
}

export function createMcpToolExecutor(
  callTool?: ConversationRuntimeMcpToolCallPort,
): ConversationRuntimeMcpToolExecutor {
  return async (input) => {
    const parsed = parseMcpToolName(input.call.name);
    if (parsed === null) {
      return createMcpExecutionResult({
        input,
        ok: false,
        content: `Tool ${input.call.name} is not a Claude Code style MCP tool name.`,
        error: "not-mcp-tool",
      });
    }
    if (callTool === undefined) {
      return createMcpExecutionResult({
        input,
        ok: false,
        content: `MCP tool ${input.call.name} is unavailable because no MCP executor is configured.`,
        error: "mcp-executor-unavailable",
        output: {
          status: "error",
          serverName: parsed.serverName,
          toolName: parsed.toolName,
          next_actions: ["configure an MCP executor for this channel/runtime"],
        },
      });
    }
    const target = resolveMcpToolTarget(input.call.metadata, parsed);
    try {
      const result = await callTool({
        turnId: input.turnId,
        sessionKey: input.sessionKey,
        serverName: target.serverName,
        toolName: target.toolName,
        args: input.call.args,
        callId: input.call.id,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      });
      return createMcpExecutionResult({
        input,
        ok: result.ok,
        content: result.content,
        ...(result.output === undefined ? {} : { output: result.output }),
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      });
    } catch (error) {
      return createMcpExecutionResult({
        input,
        ok: false,
        content: `MCP tool ${input.call.name} failed: ${toErrorMessage(error)}`,
        error: toErrorMessage(error),
      });
    }
  };
}

function resolveMcpToolTarget(
  metadata: Readonly<Record<string, unknown>> | undefined,
  fallback: { readonly serverName: string; readonly toolName: string },
): { readonly serverName: string; readonly toolName: string } {
  const serverName = metadata?.serverName;
  const toolName = metadata?.toolName;
  return {
    serverName:
      typeof serverName === "string" && serverName.length > 0 ? serverName : fallback.serverName,
    toolName: typeof toolName === "string" && toolName.length > 0 ? toolName : fallback.toolName,
  };
}

function truncateMcpDescription(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_MCP_DESCRIPTION_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_MCP_DESCRIPTION_LENGTH)}... [truncated]`;
}

function createMcpExecutionResult(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly ok: boolean;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.input.call.id,
    toolName: input.input.call.name,
    ok: input.ok,
    content: input.content,
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      source: "mcp",
      ...(input.metadata ?? {}),
    },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
