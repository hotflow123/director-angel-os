import type { InMemoryModelProviderRegistry } from "@hotflow/models";

import type {
  InternalPluginManifest,
  InternalProviderPluginRegistration,
} from "../../plugin-manifest.js";
import { ScriptedGoldenPathProviderPlugin } from "./provider.js";

const manifest: InternalPluginManifest = {
  id: "internal.provider.scripted",
  kind: "provider",
  version: "0.1.0",
  entrypoint: "./index.ts",
  displayName: "Scripted Golden Path Provider",
  description: "Deterministic local provider for golden-path and replay-style runtime flows.",
  tags: ["internal", "provider", "scripted", "golden-path"],
  capabilities: ["provider.generate", "provider.stream"],
};

export interface RegisterScriptedProviderPluginInput {
  readonly providerRegistry: InMemoryModelProviderRegistry;
}

export function registerScriptedProviderPlugin(
  input: RegisterScriptedProviderPluginInput,
): InternalProviderPluginRegistration {
  const provider = new ScriptedGoldenPathProviderPlugin();
  input.providerRegistry.register(provider);
  return {
    manifest,
    providerId: provider.id,
  };
}

export { ScriptedGoldenPathProviderPlugin, manifest };
