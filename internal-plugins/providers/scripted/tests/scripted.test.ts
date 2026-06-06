import { InMemoryModelProviderRegistry } from "@hotflow/models";
import { describe, expect, test } from "vitest";

import { ScriptedGoldenPathProvider, scriptedProviderPlugin } from "../src/index.js";

describe("scripted provider plugin", () => {
  test("registers the scripted provider", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = scriptedProviderPlugin.register({ registry });

    expect(providerIds).toEqual(["scripted"]);
    expect(registry.get("scripted")).toBeDefined();
  });

  test("requests a file read on the first step", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "user", content: "Read /tmp/README.md and summarize it." }],
    });

    expect(result.toolCalls?.[0]?.name).toBe("filesystem.read_text");
  });
});
