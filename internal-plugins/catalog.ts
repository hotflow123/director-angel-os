import { scriptedProviderPlugin } from "@hotflow/internal-plugin-provider-scripted";
import { filesystemReadToolPlugin } from "@hotflow/internal-plugin-tool-filesystem-read";
import type { InternalProviderPlugin, InternalToolPlugin } from "@hotflow/plugin-runtime";

export const INTERNAL_PROVIDER_PLUGINS = [
  scriptedProviderPlugin,
] as const satisfies readonly InternalProviderPlugin[];

export const INTERNAL_TOOL_PLUGINS = [
  filesystemReadToolPlugin,
] as const satisfies readonly InternalToolPlugin[];

export type InternalPluginEntry =
  | (typeof INTERNAL_PROVIDER_PLUGINS)[number]
  | (typeof INTERNAL_TOOL_PLUGINS)[number];

export function getInternalProviderPluginById(
  pluginId: string,
): InternalProviderPlugin | undefined {
  return INTERNAL_PROVIDER_PLUGINS.find((plugin) => plugin.manifest.id === pluginId);
}

export function getInternalToolPluginById(pluginId: string): InternalToolPlugin | undefined {
  return INTERNAL_TOOL_PLUGINS.find((plugin) => plugin.manifest.id === pluginId);
}
