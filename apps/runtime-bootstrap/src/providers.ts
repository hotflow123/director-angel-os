import {
  ScriptedGoldenPathProvider,
  scriptedProviderPlugin,
} from "@hotflow/internal-plugin-provider-scripted";
import { filesystemReadToolPlugin } from "@hotflow/internal-plugin-tool-filesystem-read";
import {
  type CreateOpenAICompatibleProviderFromEnvOptions,
  type InMemoryModelProviderRegistry,
  createOpenAICompatibleProviderFromEnv,
} from "@hotflow/models";
import {
  InternalPluginLoader,
  type InternalPluginManifest,
  PluginRegistrar,
} from "@hotflow/plugin-runtime";

export interface RegisterDefaultRuntimeProvidersOptions
  extends Pick<CreateOpenAICompatibleProviderFromEnvOptions, "env" | "fetchImpl"> {
  readonly includeScripted?: boolean;
}

export { ScriptedGoldenPathProvider };

export function createDefaultRuntimePluginLoader(): InternalPluginLoader {
  return new InternalPluginLoader({
    providers: [scriptedProviderPlugin],
    tools: [filesystemReadToolPlugin],
  });
}

export function createDefaultRuntimePluginRegistrar(): PluginRegistrar {
  return new PluginRegistrar(createDefaultRuntimePluginLoader());
}

export function getDefaultRuntimeInternalPlugins(): readonly InternalPluginManifest[] {
  return createDefaultRuntimePluginLoader().listManifests();
}

export function registerDefaultRuntimeProviders(
  providerRegistry: InMemoryModelProviderRegistry,
  options: RegisterDefaultRuntimeProvidersOptions = {},
): readonly string[] {
  const providerIds: string[] = [];

  if (options.includeScripted ?? true) {
    const scriptedProvider = new ScriptedGoldenPathProvider();
    providerRegistry.register(scriptedProvider);
    providerIds.push(scriptedProvider.id);
  }

  const openAIProvider = createOpenAICompatibleProviderFromEnv({
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (openAIProvider) {
    providerRegistry.register(openAIProvider);
    providerIds.push(openAIProvider.id);
  }

  return providerIds;
}
