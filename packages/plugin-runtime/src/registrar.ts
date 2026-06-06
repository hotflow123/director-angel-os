import { NOOP_PLUGIN_REGISTRATION_HOOKS, type PluginRegistrationHooks } from "./hooks.js";
import type {
  InternalPluginManifest,
  InternalProviderPluginRegistrationContext,
  InternalToolPluginRegistrationContext,
  ProviderRegistryPort,
  ToolRegistryPort,
} from "./internal-plugin.js";
import type { InternalPluginLoader } from "./loader.js";

export interface PluginRegistrationReport {
  readonly pluginId: string;
  readonly kind: "provider" | "tool";
  readonly registeredIds: readonly string[];
  readonly capabilities: readonly string[];
}

export interface PluginRegistrarOptions {
  readonly hooks?: PluginRegistrationHooks;
}

export class PluginRegistrar {
  private readonly hooks: PluginRegistrationHooks;

  public constructor(
    private readonly loader: InternalPluginLoader,
    options: PluginRegistrarOptions = {},
  ) {
    this.hooks = options.hooks ?? NOOP_PLUGIN_REGISTRATION_HOOKS;
  }

  public listManifests(): readonly InternalPluginManifest[] {
    return this.loader.listManifests();
  }

  public getCapabilityMap() {
    return this.loader.getCapabilityMap();
  }

  public registerProviders(
    registry: ProviderRegistryPort,
    context: Omit<InternalProviderPluginRegistrationContext, "registry"> = {},
  ): readonly PluginRegistrationReport[] {
    return this.loader.listProviderPlugins().map((plugin) => {
      const registeredIds = plugin.register({
        registry,
        ...(context.config === undefined ? {} : { config: context.config }),
        ...(context.env === undefined ? {} : { env: context.env }),
        ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
      });
      this.hooks.onPluginRegistered?.(plugin.manifest, registeredIds);
      return {
        pluginId: plugin.manifest.id,
        kind: "provider",
        registeredIds,
        capabilities: [...plugin.manifest.capabilities],
      };
    });
  }

  public registerTools(
    registry: ToolRegistryPort,
    context: Omit<InternalToolPluginRegistrationContext, "registry">,
  ): readonly PluginRegistrationReport[] {
    return this.loader.listToolPlugins().map((plugin) => {
      const registeredIds = plugin.register({
        registry,
        config: context.config,
      });
      this.hooks.onPluginRegistered?.(plugin.manifest, registeredIds);
      return {
        pluginId: plugin.manifest.id,
        kind: "tool",
        registeredIds,
        capabilities: [...plugin.manifest.capabilities],
      };
    });
  }
}
