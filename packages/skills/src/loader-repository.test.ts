import { describe, expect, test } from "vitest";

import {
  InMemorySkillLoader,
  SkillRegistry,
  SkillRepository,
  createApprovedSnapshotFromSkills,
  loadApprovedSkillsIntoRegistry,
} from "./index.js";

describe("skills approved snapshot read path", () => {
  test("loads approved snapshot into registry and repository", async () => {
    const snapshot = createApprovedSnapshotFromSkills({
      schemaVersion: "0.1.0",
      source: "runtime-bootstrap",
      skills: [
        {
          id: "react.file-summary",
          title: "File summary with todo extraction",
          body: "1. Read file\n2. Summarize\n3. Write todos",
          version: "1.0.0",
          updatedAtMs: 1,
        },
      ],
    });
    const loader = new InMemorySkillLoader(snapshot);
    const registry = new SkillRegistry();

    const loadedSnapshot = await loadApprovedSkillsIntoRegistry(loader, registry);
    const repository = new SkillRepository(loadedSnapshot);

    expect(registry.list()).toHaveLength(1);
    expect(repository.listApprovedSkills()).toHaveLength(1);
    expect(repository.getApprovedSkill("react.file-summary")?.title).toBe(
      "File summary with todo extraction",
    );
  });
});
