import { ScriptedGoldenPathProvider } from "@hotflow/internal-plugin-provider-scripted";
import type {
  CreateOpenAICompatibleProviderFromEnvOptions,
  InMemoryModelProviderRegistry,
} from "@hotflow/models";
import type {
  InternalPluginLoader,
  InternalPluginManifest,
  PluginRegistrar,
} from "@hotflow/plugin-runtime";
export interface RegisterDefaultRuntimeProvidersOptions
  extends Pick<CreateOpenAICompatibleProviderFromEnvOptions, "env" | "fetchImpl"> {
  readonly includeScripted?: boolean;
}
export { ScriptedGoldenPathProvider };
export declare function createDefaultRuntimePluginLoader(): InternalPluginLoader;
export declare function createDefaultRuntimePluginRegistrar(): PluginRegistrar;
export declare function getDefaultRuntimeInternalPlugins(): readonly InternalPluginManifest[];
export declare function registerDefaultRuntimeProviders(
  providerRegistry: InMemoryModelProviderRegistry,
  options?: RegisterDefaultRuntimeProvidersOptions,
): readonly string[];
//# sourceMappingURL=providers.d.ts.map
