import { describe, expect, test } from "vitest";

import type { InternalProviderPlugin, InternalToolPlugin } from "../src/internal-plugin.js";
import { InternalPluginLoader } from "../src/loader.js";

describe("InternalPluginLoader", () => {
  test("builds a capability map for loaded internal plugins", () => {
    const providerPlugin: InternalProviderPlugin = {
      manifest: {
        id: "provider.scripted",
        kind: "provider",
        version: "1.0.0",
        displayName: "Scripted Provider",
        capabilities: ["provider.register"],
      },
      register() {
        return ["scripted"];
      },
    };
    const toolPlugin: InternalToolPlugin = {
      manifest: {
        id: "tool.filesystem-read",
        kind: "tool",
        version: "1.0.0",
        displayName: "Filesystem Read",
        capabilities: ["tool.register", "filesystem.read"],
      },
      register() {
        return ["filesystem.read_text"];
      },
    };

    const loader = new InternalPluginLoader({
      providers: [providerPlugin],
      tools: [toolPlugin],
    });

    expect(loader.listManifests()).toHaveLength(2);
    expect(loader.getCapabilityMap()["tool.filesystem-read"]).toEqual([
      "tool.register",
      "filesystem.read",
    ]);
  });

  test("rejects duplicate manifest ids", () => {
    const duplicatePlugin: InternalProviderPlugin = {
      manifest: {
        id: "duplicate",
        kind: "provider",
        version: "1.0.0",
        displayName: "Duplicate",
        capabilities: ["provider.register"],
      },
      register() {
        return ["duplicate"];
      },
    };

    expect(
      () =>
        new InternalPluginLoader({
          providers: [duplicatePlugin],
          tools: [
            {
              manifest: {
                id: "duplicate",
                kind: "tool",
                version: "1.0.0",
                displayName: "Duplicate Tool",
                capabilities: ["tool.register"],
              },
              register() {
                return ["duplicate.tool"];
              },
            },
          ],
        }),
    ).toThrow("Duplicate internal plugin id");
  });
});
