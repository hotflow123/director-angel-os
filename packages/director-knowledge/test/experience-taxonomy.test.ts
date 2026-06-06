import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileExperienceTaxonomyStore } from "../src/experience-taxonomy.js";

describe("FileExperienceTaxonomyStore", () => {
  it("persists custom categories, tags, and candidate bindings", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-taxonomy-"));
    try {
      const store = new FileExperienceTaxonomyStore({ experienceDir: root });

      const category = await store.upsertCategory({
        name: "导演镜头",
        description: "镜头语言、景别、构图、光影和运镜经验。",
        nowMs: 1_000,
      });
      const firstTag = await store.upsertTag({ name: "景别", nowMs: 1_100 });
      const secondTag = await store.upsertTag({ name: "光影", nowMs: 1_200 });
      const binding = await store.updateCandidateTaxonomy({
        candidateId: "experience_ai_short_drama",
        categoryId: category.categoryId,
        tagIds: [firstTag.tagId, secondTag.tagId],
        updatedBy: "desktop-test",
        nowMs: 1_300,
      });
      const reloaded = new FileExperienceTaxonomyStore({ experienceDir: root });

      expect(category).toMatchObject({
        categoryId: "director-shot",
        name: "导演镜头",
      });
      expect(binding).toMatchObject({
        candidateId: "experience_ai_short_drama",
        categoryId: "director-shot",
        tagIds: ["shot-size", "lighting"],
        updatedBy: "desktop-test",
      });
      await expect(
        store.updateCandidateTaxonomy({
          candidateId: "experience_missing_category",
          categoryId: "missing",
          tagIds: [],
        }),
      ).rejects.toThrow("Unknown experience category");
      expect((await reloaded.getCandidateTaxonomy("experience_ai_short_drama"))?.tagIds).toEqual([
        "shot-size",
        "lighting",
      ]);
      expect(
        (await reloaded.inspectTaxonomy()).categories.map((entry) => entry.categoryId),
      ).toEqual(expect.arrayContaining(["all", "director-shot", "uncategorized"]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
