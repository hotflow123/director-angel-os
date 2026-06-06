import type { InternalPluginManifest } from "@hotflow/plugin-runtime";
import { INTERNAL_PROVIDER_PLUGINS, INTERNAL_TOOL_PLUGINS } from "./catalog.js";

export const INTERNAL_PLUGIN_MANIFESTS: readonly InternalPluginManifest[] = [
  ...INTERNAL_PROVIDER_PLUGINS.map((plugin) => plugin.manifest),
  ...INTERNAL_TOOL_PLUGINS.map((plugin) => plugin.manifest),
];
