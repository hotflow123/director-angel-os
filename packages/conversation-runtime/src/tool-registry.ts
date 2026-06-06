import { createBuiltinBrowserTools } from "./builtin-browser-tools.js";
import { createBuiltinWebTools } from "./builtin-web-tools.js";
import { createBuiltinXTools } from "./builtin-x-tools.js";
import { type ExternalToolCheckFunction, resolveEffectiveModelTools } from "./external-tools.js";
import {
  type ConversationRuntimeMcpToolProvider,
  createConversationRuntimeMcpTools,
} from "./mcp-tool-provider.js";
import type { ConversationRuntimeModelToolDefinition } from "./model-tool-loop.js";
import { createToolSearchTool } from "./tool-search.js";

export interface ConversationRuntimeToolRegistry {
  readonly listModelTools: () => readonly ConversationRuntimeModelToolDefinition[];
}

export interface AsyncConversationRuntimeToolRegistry {
  readonly listModelTools: () => Promise<readonly ConversationRuntimeModelToolDefinition[]>;
}

export interface CreateConversationRuntimeToolRegistryOptions {
  readonly directorTools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly builtinTools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly mcpTools?: readonly ConversationRuntimeModelToolDefinition[];
}

export interface CreateAsyncConversationRuntimeToolRegistryOptions
  extends CreateConversationRuntimeToolRegistryOptions {
  readonly mcpToolProvider?: ConversationRuntimeMcpToolProvider;
  readonly effectiveToolChecks?:
    | ReadonlyMap<string, ExternalToolCheckFunction>
    | Readonly<Record<string, ExternalToolCheckFunction>>;
}

export function createConversationRuntimeToolRegistry(
  options: CreateConversationRuntimeToolRegistryOptions = {},
): ConversationRuntimeToolRegistry {
  const tools = mergeConversationRuntimeTools([
    ...(options.builtinTools ?? [
      ...createBuiltinWebTools(),
      ...createBuiltinXTools(),
      ...createBuiltinBrowserTools(),
      createToolSearchTool(),
    ]),
    ...(options.directorTools ?? []),
    ...(options.mcpTools ?? []),
  ]);
  return {
    listModelTools: () => tools,
  };
}

export function createAsyncConversationRuntimeToolRegistry(
  options: CreateAsyncConversationRuntimeToolRegistryOptions = {},
): AsyncConversationRuntimeToolRegistry {
  return {
    listModelTools: async () => {
      const builtinTools = options.builtinTools ?? [
        ...createBuiltinWebTools(),
        ...createBuiltinXTools(),
        ...createBuiltinBrowserTools(),
        createToolSearchTool(),
      ];
      const staticTools = [
        ...builtinTools,
        ...(options.directorTools ?? []),
        ...(options.mcpTools ?? []),
      ];
      const mcpTools = await createConversationRuntimeMcpTools({
        ...(options.mcpToolProvider === undefined ? {} : { provider: options.mcpToolProvider }),
        reservedToolNames: staticTools.map((tool) => tool.name),
      });
      const tools = mergeConversationRuntimeTools([...staticTools, ...mcpTools]);
      if (options.effectiveToolChecks === undefined) {
        return tools;
      }
      return resolveEffectiveModelTools({
        tools,
        check: options.effectiveToolChecks,
      });
    },
  };
}

export function mergeConversationRuntimeTools(
  tools: readonly ConversationRuntimeModelToolDefinition[],
): readonly ConversationRuntimeModelToolDefinition[] {
  const seen = new Set<string>();
  const merged: ConversationRuntimeModelToolDefinition[] = [];
  for (const tool of [...tools].sort(compareConversationRuntimeToolStable)) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    merged.push(tool);
  }
  return merged;
}

function compareConversationRuntimeToolStable(
  left: ConversationRuntimeModelToolDefinition,
  right: ConversationRuntimeModelToolDefinition,
): number {
  const leftMcp = left.metadata?.source === "mcp" || left.name.startsWith("mcp__");
  const rightMcp = right.metadata?.source === "mcp" || right.name.startsWith("mcp__");
  if (leftMcp !== rightMcp) {
    return leftMcp ? 1 : -1;
  }
  return left.name.localeCompare(right.name);
}
