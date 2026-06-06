export type InternalPluginKind = "provider" | "tool";

export interface InternalPluginManifest {
  readonly id: string;
  readonly kind: InternalPluginKind;
  readonly version: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: readonly string[];
}

export interface PluginRuntimeConfig {
  readonly workspaceRoot: string;
  readonly dataDir?: string;
  readonly sessionDbPath?: string;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
}

export interface ProviderRegistryPort {
  register(provider: {
    readonly id: string;
    generate(request: unknown): Promise<unknown>;
    stream?(request: unknown): AsyncIterable<unknown>;
  }): void;
}

export interface ToolRegistryPort {
  register(tool: {
    readonly name: string;
    readonly description: string;
    readonly timeoutMs: number;
    readonly readOnly: boolean;
    execute(args: unknown, context: unknown): Promise<unknown> | unknown;
  }): void;
}

export interface InternalProviderPluginRegistrationContext {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly config?: PluginRuntimeConfig;
  readonly registry: ProviderRegistryPort;
}

export interface InternalToolPluginRegistrationContext {
  readonly config: PluginRuntimeConfig;
  readonly registry: ToolRegistryPort;
}

export interface InternalProviderPlugin {
  readonly manifest: InternalPluginManifest & { readonly kind: "provider" };
  register(context: InternalProviderPluginRegistrationContext): readonly string[];
}

export interface InternalToolPlugin {
  readonly manifest: InternalPluginManifest & { readonly kind: "tool" };
  register(context: InternalToolPluginRegistrationContext): readonly string[];
}
