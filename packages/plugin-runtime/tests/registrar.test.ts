import { describe, expect, test } from "vitest";

import type { InternalProviderPlugin, InternalToolPlugin } from "../src/internal-plugin.js";
import { InternalPluginLoader } from "../src/loader.js";
import { PluginRegistrar } from "../src/registrar.js";

describe("PluginRegistrar", () => {
  test("registers internal provider and tool plugins into runtime registries", () => {
    const providerRegistry = createProviderRegistryStub();
    const toolRegistry = createToolRegistryStub();

    const providerPlugin: InternalProviderPlugin = {
      manifest: {
        id: "provider.scripted",
        kind: "provider",
        version: "1.0.0",
        displayName: "Scripted Provider",
        capabilities: ["provider.register"],
      },
      register(context) {
        context.registry.register({
          id: "scripted",
          async generate() {
            return {
              text: "ok",
              finishReason: "stop",
            };
          },
          async *stream() {
            yield { type: "response.started" };
            yield { type: "response.completed", finishReason: "stop" };
          },
        });
        return ["scripted"];
      },
    };
    const toolPlugin: InternalToolPlugin = {
      manifest: {
        id: "tool.filesystem-read",
        kind: "tool",
        version: "1.0.0",
        displayName: "Filesystem Read",
        capabilities: ["tool.register"],
      },
      register(context) {
        context.registry.register({
          name: "filesystem.read_text",
          description: "Read file",
          timeoutMs: 100,
          readOnly: true,
          async execute() {
            return {
              toolCallId: "tool_1",
              toolName: "filesystem.read_text",
              ok: true,
              output: "content",
            };
          },
        });
        return ["filesystem.read_text"];
      },
    };

    const registrar = new PluginRegistrar(
      new InternalPluginLoader({
        providers: [providerPlugin],
        tools: [toolPlugin],
      }),
    );

    const providerReports = registrar.registerProviders(providerRegistry, {});
    const toolReports = registrar.registerTools(toolRegistry, {
      config: {
        workspaceRoot: "/workspace",
        dataDir: "/workspace/.hotflow",
        sessionDbPath: "/workspace/.hotflow/sessions.sqlite",
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
      },
    });

    expect(providerReports[0]?.registeredIds).toEqual(["scripted"]);
    expect(toolReports[0]?.registeredIds).toEqual(["filesystem.read_text"]);
    expect(providerRegistry.providers.get("scripted")).toBeDefined();
    expect(toolRegistry.tools.get("filesystem.read_text")).toBeDefined();
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
