import { InMemoryModelProviderRegistry } from "@hotflow/models";
import { describe, expect, test } from "vitest";

import {
  ScriptedGoldenPathProvider,
  getDefaultRuntimeInternalPlugins,
  registerDefaultRuntimeProviders,
} from "../src/providers.js";

describe("registerDefaultRuntimeProviders", () => {
  test("registers scripted provider by default", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = registerDefaultRuntimeProviders(registry, { env: {} });

    expect(providerIds).toContain("scripted");
    expect(registry.get("scripted")).toBeDefined();
  });

  test("can skip scripted provider when includeScripted is false", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = registerDefaultRuntimeProviders(registry, {
      env: {},
      includeScripted: false,
    });

    expect(providerIds).toEqual([]);
    expect(registry.get("scripted")).toBeUndefined();
  });

  test("registers openai-compatible provider when env is configured", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = registerDefaultRuntimeProviders(registry, {
      env: {
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    expect(providerIds).toContain("scripted");
    expect(providerIds).toContain("openai-live");
    expect(registry.get("openai-live")).toBeDefined();
  });
});

describe("getDefaultRuntimeInternalPlugins", () => {
  test("returns default provider/tool manifests", () => {
    const manifests = getDefaultRuntimeInternalPlugins();

    expect(manifests.map((manifest) => manifest.id)).toEqual([
      "provider.scripted",
      "tool.filesystem-read",
    ]);
  });
});

describe("ScriptedGoldenPathProvider", () => {
  test("requests file read as first tool call", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "user", content: "Read /tmp/README.md and summarize it." }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls?.[0]?.name).toBe("filesystem.read_text");
  });
});
