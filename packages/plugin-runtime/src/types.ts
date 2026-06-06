export type InternalPluginKind = "provider" | "tool";

export interface InternalPluginManifestBase {
  readonly id: string;
  readonly version: string;
  readonly kind: InternalPluginKind;
  readonly capabilities: readonly string[];
  readonly description?: string;
}

export interface ProviderPluginRegistrationContext {
  readonly providerRegistry: {
    register(provider: {
      readonly id: string;
      generate(request: unknown): Promise<unknown>;
      stream?(request: unknown): AsyncIterable<unknown>;
    }): void;
  };
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

export interface ToolPluginRegistrationContext {
  readonly registry: {
    register(tool: {
      readonly name: string;
      readonly description: string;
      readonly timeoutMs: number;
      readonly readOnly: boolean;
      execute(args: unknown, context: unknown): Promise<unknown> | unknown;
    }): void;
  };
  readonly workspaceRoot: string;
  readonly taskBoard: {
    writeTodos?(items: readonly unknown[]): unknown;
  };
}

export interface ProviderPluginManifest extends InternalPluginManifestBase {
  readonly kind: "provider";
  register(context: ProviderPluginRegistrationContext): readonly string[];
}

export interface ToolPluginManifest extends InternalPluginManifestBase {
  readonly kind: "tool";
  register(context: ToolPluginRegistrationContext): readonly string[];
}

export type InternalPluginManifest = ProviderPluginManifest | ToolPluginManifest;

export interface LoadedInternalPlugin<
  TManifest extends InternalPluginManifest = InternalPluginManifest,
> {
  readonly manifest: TManifest;
  readonly capabilitySet: ReadonlySet<string>;
}

export type PluginCapabilityMap = ReadonlyMap<string, readonly string[]>;

export interface PluginRegistrationSummary {
  readonly pluginIds: readonly string[];
  readonly registeredIds: readonly string[];
  readonly capabilityMap: PluginCapabilityMap;
}
