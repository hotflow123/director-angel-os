import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FileSkillTaxonomyStore,
  SKILL_TAXONOMY_SCHEMA_VERSION,
  resolveSkillTaxonomyPath,
} from "../src/taxonomy.js";

describe("FileSkillTaxonomyStore", () => {
  it("persists custom categories, tags, and skill bindings", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-taxonomy-"));
    try {
      const store = new FileSkillTaxonomyStore({ skillsDir: root });

      const category = await store.upsertCategory({
        name: "Coding",
        description: "Implementation, review, and verification skills.",
        nowMs: 1_000,
      });
      const firstTag = await store.upsertTag({ name: "TypeScript", nowMs: 1_100 });
      const secondTag = await store.upsertTag({ name: "Review", nowMs: 1_200 });
      const binding = await store.updateSkillTaxonomy({
        skillId: "skills-taxonomy-helper",
        categoryId: category.categoryId,
        tagIds: [firstTag.tagId, secondTag.tagId, firstTag.tagId],
        updatedBy: "taxonomy-test",
        nowMs: 1_300,
      });
      const reloaded = new FileSkillTaxonomyStore({ skillsDir: root });

      expect(category).toMatchObject({
        categoryId: "coding",
        name: "Coding",
        createdAtMs: 0,
        updatedAtMs: 1_000,
      });
      expect(binding).toEqual({
        skillId: "skills-taxonomy-helper",
        categoryId: "coding",
        tagIds: ["typescript", "review"],
        updatedAtMs: 1_300,
        updatedBy: "taxonomy-test",
      });
      expect(await reloaded.readSkillTaxonomy("skills-taxonomy-helper")).toEqual(binding);
      expect(await reloaded.resolveSkillTaxonomy("skills-taxonomy-helper")).toEqual({
        skillId: "skills-taxonomy-helper",
        categoryId: "coding",
        categoryName: "Coding",
        tagIds: ["typescript", "review"],
        tagNames: ["TypeScript", "Review"],
        tags: ["category:coding", "user-tag:typescript", "user-tag:review"],
      });
      expect((await reloaded.listCategories()).map((entry) => entry.categoryId)).toEqual(
        expect.arrayContaining(["all", "coding", "uncategorized"]),
      );
      expect((await reloaded.listTags()).map((entry) => entry.tagId)).toEqual([
        "review",
        "typescript",
      ]);
      expect((await reloaded.listSkillTaxonomies()).map((entry) => entry.skillId)).toEqual([
        "skills-taxonomy-helper",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes taxonomy documents and validates references", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-taxonomy-"));
    try {
      const store = new FileSkillTaxonomyStore({ skillsDir: root });

      await expect(
        store.updateSkillTaxonomy({
          skillId: "missing-category",
          categoryId: "does-not-exist",
        }),
      ).rejects.toThrow("Unknown skill category: does-not-exist");

      await expect(
        store.updateSkillTaxonomy({
          skillId: "missing-tag",
          tagIds: ["does-not-exist"],
        }),
      ).rejects.toThrow("Unknown skill tag: does-not-exist");

      const tag = await store.upsertTag({
        tagId: "导演镜头",
        name: "导演镜头",
        nowMs: 2_000,
      });
      expect(tag.tagId).toMatch(/^custom-/u);

      await store.updateSkillTaxonomy({
        skillId: "unclassified",
        tagIds: [tag.tagId],
        nowMs: 2_100,
      });
      const document = JSON.parse(await readFile(join(root, "taxonomy.json"), "utf8")) as {
        schemaVersion?: string;
        skills?: unknown[];
      };

      expect(document.schemaVersion).toBe(SKILL_TAXONOMY_SCHEMA_VERSION);
      expect(document.skills).toHaveLength(1);
      expect(await store.resolveSkillTaxonomy("not-bound")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves the default and override taxonomy paths", () => {
    expect(resolveSkillTaxonomyPath({ dataDir: "/tmp/hotflow" })).toBe(
      "/tmp/hotflow/skills/taxonomy.json",
    );
    expect(
      resolveSkillTaxonomyPath(
        { dataDir: "/tmp/hotflow" },
        { HOTFLOW_SKILLS_TAXONOMY_PATH: "/tmp/custom-taxonomy.json" },
      ),
    ).toBe("/tmp/custom-taxonomy.json");
  });
});
