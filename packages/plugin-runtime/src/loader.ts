import { type PluginCapabilityMap, createPluginCapabilityMap } from "./capabilities.js";
import type {
  InternalPluginManifest,
  InternalProviderPlugin,
  InternalToolPlugin,
} from "./internal-plugin.js";

export interface InternalPluginLoaderInput {
  readonly providers?: readonly InternalProviderPlugin[];
  readonly tools?: readonly InternalToolPlugin[];
}

export class InternalPluginLoader {
  private readonly providers: readonly InternalProviderPlugin[];
  private readonly tools: readonly InternalToolPlugin[];
  private readonly manifests: readonly InternalPluginManifest[];
  private readonly capabilityMap: PluginCapabilityMap;

  public constructor(input: InternalPluginLoaderInput = {}) {
    this.providers = [...(input.providers ?? [])];
    this.tools = [...(input.tools ?? [])];
    this.assertUniqueIds([
      ...this.providers.map((plugin) => plugin.manifest),
      ...this.tools.map((plugin) => plugin.manifest),
    ]);
    this.manifests = [
      ...this.providers.map((plugin) => plugin.manifest),
      ...this.tools.map((plugin) => plugin.manifest),
    ];
    this.capabilityMap = createPluginCapabilityMap(this.manifests);
  }

  public listManifests(): readonly InternalPluginManifest[] {
    return [...this.manifests];
  }

  public listProviderPlugins(): readonly InternalProviderPlugin[] {
    return [...this.providers];
  }

  public listToolPlugins(): readonly InternalToolPlugin[] {
    return [...this.tools];
  }

  public getCapabilityMap(): PluginCapabilityMap {
    return this.capabilityMap;
  }

  private assertUniqueIds(manifests: readonly InternalPluginManifest[]): void {
    const seen = new Set<string>();
    for (const manifest of manifests) {
      if (seen.has(manifest.id)) {
        throw new Error(`Duplicate internal plugin id: ${manifest.id}`);
      }
      seen.add(manifest.id);
    }
  }
}
