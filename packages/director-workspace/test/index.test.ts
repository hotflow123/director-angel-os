import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDirectorWorkspace } from "../src/index.js";

describe("director-workspace", () => {
  const tempRoot = resolve(tmpdir(), "director-workspace-test");

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates the expected directories", () => {
    const paths = ensureDirectorWorkspace({ root: tempRoot });
    expect(paths.workspace.endsWith(".director-angel/workspace")).toBe(true);
    expect(paths.knowledge.endsWith(".director-angel/knowledge")).toBe(true);
    expect(paths.knowledgePublished.endsWith(".director-angel/knowledge/published")).toBe(true);
    expect(paths.adaptersRegistry.endsWith(".director-angel/adapters/registry")).toBe(true);
  });
});
