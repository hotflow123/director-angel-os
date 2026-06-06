import { describe, expect, it } from "vitest";

import { assertInternalPluginManifest, isInternalPluginManifest } from "../src/manifest.js";

describe("internal plugin manifest", () => {
  it("accepts provider manifests", () => {
    const manifest = {
      id: "providers.scripted",
      kind: "provider",
      version: "0.1.0",
      providerId: "scripted",
      capabilities: ["model.generate"],
    };

    expect(isInternalPluginManifest(manifest)).toBe(true);
    expect(assertInternalPluginManifest(manifest)).toEqual(manifest);
  });

  it("accepts tool manifests", () => {
    const manifest = {
      id: "tools.filesystem-read",
      kind: "tool",
      version: "0.1.0",
      toolName: "filesystem.read_text",
      capabilities: ["filesystem.read"],
    };

    expect(isInternalPluginManifest(manifest)).toBe(true);
  });

  it("rejects invalid manifests", () => {
    const invalid = {
      id: "",
      kind: "provider",
      version: "0.1.0",
      providerId: "scripted",
    };

    expect(isInternalPluginManifest(invalid)).toBe(false);
    expect(() => assertInternalPluginManifest(invalid)).toThrow(
      "Invalid internal plugin manifest.",
    );
  });
});
