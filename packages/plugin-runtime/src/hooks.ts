import type { InternalPluginManifest } from "./internal-plugin.js";

export interface PluginRegistrationHooks {
  onPluginRegistered?(manifest: InternalPluginManifest, registeredIds: readonly string[]): void;
}

export const NOOP_PLUGIN_REGISTRATION_HOOKS: PluginRegistrationHooks = {};
