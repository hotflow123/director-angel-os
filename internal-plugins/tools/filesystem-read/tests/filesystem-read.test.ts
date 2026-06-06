import { ToolRegistry } from "@hotflow/tools";
import { describe, expect, test } from "vitest";

import { filesystemReadToolPlugin } from "../src/index.js";

describe("filesystem read tool plugin", () => {
  test("registers the filesystem.read_text tool", () => {
    const registry = new ToolRegistry();
    const toolIds = filesystemReadToolPlugin.register({
      config: {
        workspaceRoot: "/workspace",
      },
      registry,
    });

    expect(toolIds).toEqual(["filesystem.read_text"]);
    expect(registry.get("filesystem.read_text")).toBeDefined();
  });
});
