import { describe, expect, test } from "vitest";

import { SkillPromptIndex } from "./prompt-index.js";
import type { SkillSnapshot } from "./registry.js";

const SKILLS: readonly SkillSnapshot[] = [
  {
    id: "skill.readme-summary",
    title: "README summarize flow",
    summary: "Use filesystem.read_text then summarize",
    body: "Read README.md and produce concise summary.",
    tags: ["readme", "summary"],
    toolNames: ["filesystem.read_text"],
    version: "1.0.0",
    updatedAtMs: 1,
  },
  {
    id: "skill.todo-write",
    title: "Todo write flow",
    body: "Write structured todos to task board.",
    tags: ["todo"],
    toolNames: ["tasks.todo_write"],
    version: "1.0.0",
    updatedAtMs: 2,
  },
];

describe("SkillPromptIndex", () => {
  test("creates skill-owned prompt sections", () => {
    const index = new SkillPromptIndex(() => SKILLS);
    const sections = index.buildSections({ limit: 1, cacheBucket: "dynamic" });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.owner).toBe("skill");
    expect(sections[0]?.id).toBe("skill.skill.readme-summary");
    expect(sections[0]?.content).toContain("README summarize flow");
  });

  test("filters skills by query", () => {
    const index = new SkillPromptIndex(() => SKILLS);
    const sections = index.buildSections({ query: "todo write" });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("skill.skill.todo-write");
    expect(sections[0]?.content).toContain("tasks.todo_write");
  });
});
