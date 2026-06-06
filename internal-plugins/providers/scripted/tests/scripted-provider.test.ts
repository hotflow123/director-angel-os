import { InMemoryModelProviderRegistry } from "@hotflow/models";
import { describe, expect, test } from "vitest";

import { ScriptedGoldenPathProvider, scriptedProviderPlugin } from "../src/index.js";

describe("scriptedProviderPlugin", () => {
  test("registers scripted provider through internal plugin contract", () => {
    const registry = new InMemoryModelProviderRegistry();
    const registeredIds = scriptedProviderPlugin.register({ registry });

    expect(registeredIds).toEqual(["scripted"]);
    expect(registry.get("scripted")).toBeDefined();
  });
});

describe("ScriptedGoldenPathProvider", () => {
  test("requests filesystem read before summarizing", async () => {
    const provider = new ScriptedGoldenPathProvider();

    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "user", content: "Read /tmp/README.md and summarize it." }],
    });

    expect(result.toolCalls?.[0]?.name).toBe("filesystem.read_text");
  });
});
