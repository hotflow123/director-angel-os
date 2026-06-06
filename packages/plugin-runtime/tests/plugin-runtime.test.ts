import { describe, expect, test } from "vitest";

import {
  InternalPluginLoader,
  type InternalProviderPlugin,
  type InternalToolPlugin,
  PluginLoader,
  PluginRegistrar,
} from "../src/index.js";

describe("plugin-runtime", () => {
  test("exports PluginLoader alias without changing InternalPluginLoader semantics", () => {
    const aliasLoader = new PluginLoader();
    const internalLoader = new InternalPluginLoader();

    expect(aliasLoader).toBeInstanceOf(InternalPluginLoader);
    expect(aliasLoader.listManifests()).toEqual(internalLoader.listManifests());
  });

  test("rejects duplicate plugin ids", () => {
    const duplicateProvider: InternalProviderPlugin = {
      manifest: {
        id: "plugin.duplicate",
        version: "0.1.0",
        kind: "provider",
        displayName: "Duplicate Provider",
        capabilities: ["provider:test"],
      },
      register() {
        return ["provider-a"];
      },
    };
    const duplicateTool: InternalToolPlugin = {
      manifest: {
        id: "plugin.duplicate",
        version: "0.1.0",
        kind: "tool",
        displayName: "Duplicate Tool",
        capabilities: ["tool:test"],
      },
      register() {
        return ["tool-a"];
      },
    };

    expect(
      () =>
        new InternalPluginLoader({
          providers: [duplicateProvider],
          tools: [duplicateTool],
        }),
    ).toThrow("Duplicate internal plugin id");
  });

  test("registers provider and tool manifests through one registrar", () => {
    const providerRegistry = createProviderRegistryStub();
    const toolRegistry = createToolRegistryStub();
    const plugins = new InternalPluginLoader({
      providers: [
        {
          manifest: {
            id: "provider.fake",
            version: "0.1.0",
            kind: "provider",
            displayName: "Provider Fake",
            capabilities: ["provider:fake"],
          },
          register({ registry }) {
            registry.register({
              id: "provider-fake",
              async generate() {
                return { text: "ok" };
              },
            });
            return ["provider-fake"];
          },
        },
      ],
      tools: [
        {
          manifest: {
            id: "tool.fake",
            version: "0.1.0",
            kind: "tool",
            displayName: "Tool Fake",
            capabilities: ["tool:fake"],
          },
          register({ registry }) {
            registry.register({
              name: "tool.fake",
              description: "Fake tool",
              timeoutMs: 10,
              readOnly: true,
              execute() {
                return { ok: true };
              },
            });
            return ["tool.fake"];
          },
        },
      ],
    });

    const registrar = new PluginRegistrar(plugins);

    const providerSummary = registrar.registerProviders(providerRegistry, {});
    const toolSummary = registrar.registerTools(toolRegistry, {
      config: { workspaceRoot: "/workspace" },
    });

    expect(providerSummary[0]?.pluginId).toBe("provider.fake");
    expect(providerSummary[0]?.registeredIds).toEqual(["provider-fake"]);
    expect(providerRegistry.providers.get("provider-fake")).toBeDefined();
    expect(toolSummary[0]?.pluginId).toBe("tool.fake");
    expect(toolSummary[0]?.registeredIds).toEqual(["tool.fake"]);
    expect(toolRegistry.tools.get("tool.fake")).toBeDefined();
  });
});

function createProviderRegistryStub(): {
  readonly providers: Map<string, unknown>;
  register(provider: { readonly id: string }): void;
} {
  const providers = new Map<string, unknown>();
  return {
    providers,
    register(provider) {
      providers.set(provider.id, provider);
    },
  };
}

function createToolRegistryStub(): {
  readonly tools: Map<string, unknown>;
  register(tool: { readonly name: string }): void;
} {
  const tools = new Map<string, unknown>();
  return {
    tools,
    register(tool) {
      tools.set(tool.name, tool);
    },
  };
}
