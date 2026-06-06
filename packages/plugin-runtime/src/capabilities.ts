import type { InternalPluginManifest } from "./internal-plugin.js";

export type PluginCapabilityMap = Readonly<Record<string, readonly string[]>>;

export function createPluginCapabilityMap(
  manifests: readonly InternalPluginManifest[],
): PluginCapabilityMap {
  return Object.freeze(
    Object.fromEntries(manifests.map((manifest) => [manifest.id, [...manifest.capabilities]])),
  );
}
