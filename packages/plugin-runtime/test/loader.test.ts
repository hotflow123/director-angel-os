import { describe, expect, it } from "vitest";

import { PluginLoader, loadInternalPlugins } from "../src/loader.js";
import { PluginRegistrar, RuntimePluginRegistrar } from "../src/registrar.js";

function createProvider(id: string) {
  return {
    id,
    async generate() {
      return { text: "ok" };
    },
    async *stream() {
      yield { type: "response.started" as const };
      yield { type: "response.completed" as const };
    },
  };
}

function createTool(name: string) {
  return {
    name,
    description: "test tool",
    timeoutMs: 1_000,
    readOnly: true,
    async execute() {
      return {
        toolCallId: "test-call",
        toolName: name,
        ok: true,
        output: "ok",
      };
    },
  };
}

describe("loadInternalPlugins", () => {
  it("exposes aligned class names used by benchmark gates", async () => {
    const providers: ReturnType<typeof createProvider>[] = [];
    const tools: ReturnType<typeof createTool>[] = [];
    const registrar = new PluginRegistrar(
      {
        register(provider) {
          providers.push(provider);
        },
      },
      {
        register(definition) {
          tools.push(definition);
        },
      },
    );
    const loader = new PluginLoader();

    const result = await loader.load(
      [
        {
          manifest: {
            id: "providers.scripted",
            kind: "provider",
            version: "0.1.0",
            providerId: "scripted",
          },
          register(runtimeRegistrar) {
            runtimeRegistrar.registerProvider(createProvider("scripted"));
          },
        },
      ],
      registrar,
    );

    expect(result.loadedIds).toEqual(["providers.scripted"]);
    expect(providers).toHaveLength(1);
    expect(tools).toHaveLength(0);
  });

  it("loads provider and tool modules via registrar", async () => {
    const providers: ReturnType<typeof createProvider>[] = [];
    const tools: ReturnType<typeof createTool>[] = [];
    const registrar = new RuntimePluginRegistrar(
      {
        register(provider) {
          providers.push(provider);
        },
      },
      {
        register(definition) {
          tools.push(definition);
        },
      },
    );

    const result = await loadInternalPlugins(
      [
        {
          manifest: {
            id: "providers.scripted",
            kind: "provider",
            version: "0.1.0",
            providerId: "scripted",
            capabilities: ["model.generate", "model.stream"],
          },
          register(runtimeRegistrar) {
            runtimeRegistrar.registerProvider(createProvider("scripted"));
          },
        },
        {
          manifest: {
            id: "tools.filesystem-read",
            kind: "tool",
            version: "0.1.0",
            toolName: "filesystem.read_text",
            capabilities: ["filesystem.read"],
          },
          register(runtimeRegistrar) {
            runtimeRegistrar.registerTool(createTool("filesystem.read_text"));
          },
        },
      ],
      registrar,
    );

    expect(providers).toHaveLength(1);
    expect(tools).toHaveLength(1);
    expect(result.loadedIds).toEqual(["providers.scripted", "tools.filesystem-read"]);
    expect(result.loadedKinds).toEqual(["provider", "tool"]);
    expect(result.capabilities.providers).toEqual(["model.generate", "model.stream"]);
    expect(result.capabilities.tools).toEqual(["filesystem.read"]);
  });

  it("rejects duplicate plugin ids", async () => {
    const registrar = new RuntimePluginRegistrar({ register() {} }, { register() {} });

    await expect(
      loadInternalPlugins(
        [
          {
            manifest: {
              id: "duplicate",
              kind: "provider",
              version: "0.1.0",
              providerId: "scripted",
            },
            register() {},
          },
          {
            manifest: {
              id: "duplicate",
              kind: "tool",
              version: "0.1.0",
              toolName: "filesystem.read_text",
            },
            register() {},
          },
        ],
        registrar,
      ),
    ).rejects.toThrow("Duplicate internal plugin id: duplicate");
  });
});
