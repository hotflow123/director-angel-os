import {
  ScriptedGoldenPathProvider,
  scriptedProviderPlugin,
} from "@hotflow/internal-plugin-provider-scripted";
import { filesystemReadToolPlugin } from "@hotflow/internal-plugin-tool-filesystem-read";
import { createOpenAICompatibleProviderFromEnv } from "@hotflow/models";
import { InternalPluginLoader, PluginRegistrar } from "@hotflow/plugin-runtime";
export { ScriptedGoldenPathProvider };
export function createDefaultRuntimePluginLoader() {
  return new InternalPluginLoader({
    providers: [scriptedProviderPlugin],
    tools: [filesystemReadToolPlugin],
  });
}
export function createDefaultRuntimePluginRegistrar() {
  return new PluginRegistrar(createDefaultRuntimePluginLoader());
}
export function getDefaultRuntimeInternalPlugins() {
  return createDefaultRuntimePluginLoader().listManifests();
}
export function registerDefaultRuntimeProviders(providerRegistry, options = {}) {
  const providerIds = [];
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
//# sourceMappingURL=providers.js.map
