import { describe, expect, it } from "vitest";

import {
  createCapabilityMapFromManifests,
  createEmptyCapabilityMap,
  mergeCapabilityMaps,
} from "../src/capabilities.js";

describe("plugin capability map", () => {
  it("builds capability map from provider and tool manifests", () => {
    const map = createCapabilityMapFromManifests([
      {
        id: "provider.a",
        kind: "provider",
        version: "0.1.0",
        providerId: "a",
        capabilities: ["model.generate", "model.stream"],
      },
      {
        id: "tool.a",
        kind: "tool",
        version: "0.1.0",
        toolName: "filesystem.read_text",
        capabilities: ["filesystem.read"],
      },
    ]);

    expect(map.providers).toEqual(["model.generate", "model.stream"]);
    expect(map.tools).toEqual(["filesystem.read"]);
  });

  it("merges and deduplicates capability maps", () => {
    const merged = mergeCapabilityMaps(createEmptyCapabilityMap(), {
      providers: ["model.generate", "model.generate"],
      tools: ["filesystem.read"],
    });

    expect(merged.providers).toEqual(["model.generate"]);
    expect(merged.tools).toEqual(["filesystem.read"]);
  });
});
