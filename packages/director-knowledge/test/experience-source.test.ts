import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalReferenceRepositoryExperienceAdapter } from "../src/experience-source.js";

describe("LocalReferenceRepositoryExperienceAdapter", () => {
  it("materializes review-gated experience candidates from configured repo files", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-source-"));
    try {
      writeFileSync(
        join(root, "README.md"),
        [
          "# MemPalace",
          "",
          "Use explicit source adapters, declared transformations, and review gates.",
        ].join("\n"),
      );
      writeFileSync(
        join(root, "patterns.md"),
        [
          "# Incremental ingest",
          "",
          "Track source fingerprints and only reprocess changed reference inputs.",
        ].join("\n"),
      );

      const adapter = new LocalReferenceRepositoryExperienceAdapter({
        repoId: "mempalace",
        sourceRoot: root,
        include: ["patterns.md", "README.md"],
        sourceRef: "repo://mempalace",
        privacy: "internal",
        transformations: [
          {
            transformId: "summarize",
            kind: "summarize",
            summary: "Summarize reusable repository patterns.",
          },
        ],
        nowMs: () => 1_000,
      });

      const first = await adapter.ingest();
      const second = await adapter.ingest({ sinceCursor: first.cursor });

      expect(first.status).toBe("ok");
      expect(first.adapter.sourceKind).toBe("local-repository");
      expect(first.adapter.privacy).toBe("internal");
      expect(first.adapter.incremental.cursor).toBe(first.cursor);
      expect(first.candidates).toHaveLength(2);
      expect(first.candidates.map((candidate) => candidate.evidence[0]?.path)).toEqual([
        "README.md",
        "patterns.md",
      ]);
      expect(first.candidates[0]).toMatchObject({
        status: "candidate",
        runtimeInjection: "disabled",
        privacy: "internal",
        provenance: "director-knowledge/local-reference-repository",
      });
      expect(first.candidates[0]?.tags).toEqual(
        expect.arrayContaining(["external-reference", "repo:mempalace", "source:local-repository"]),
      );
      expect(second.status).toBe("ok");
      expect(second.cursor).toBe(first.cursor);
      expect(second.candidates).toEqual([]);
      expect(second.notes).toContain("No local reference repository changes detected.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects configured files that escape the source root", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-experience-source-"));
    try {
      const adapter = new LocalReferenceRepositoryExperienceAdapter({
        repoId: "unsafe",
        sourceRoot: root,
        include: ["../secret.md"],
      });

      await expect(adapter.ingest()).rejects.toThrow("outside source root");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
