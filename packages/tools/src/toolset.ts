import type { ToolDefinition } from "./contracts.js";

export const DEFAULT_TOOLSET_NAME = "default";

export function resolveToolsetName(definition: Pick<ToolDefinition, "toolset">): string {
  return definition.toolset?.trim() || DEFAULT_TOOLSET_NAME;
}
