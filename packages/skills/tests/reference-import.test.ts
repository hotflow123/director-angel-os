import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  FileSkillTaxonomyStore,
  SkillManagementStore,
  SkillSnapshotFileStore,
  importReferenceSkills,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0, cleanupPaths.length)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("importReferenceSkills", () => {
  test("imports external SKILL.md files as approved skills with enablement and cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "hotflow-reference-skills-"));
    cleanupPaths.push(root);
    const repo = join(root, "ref");
    const dataDir = join(root, ".hotflow");
    mkdirSync(join(repo, "skills", "creative", "story"), { recursive: true });
    writeFileSync(
      join(repo, "skills", "creative", "story", "SKILL.md"),
      [
        "---",
        "name: story-lens",
        "description: Generate story ideas for short videos.",
        "version: 1.0.0",
        "tags: [creative, video]",
        "---",
        "# Story Lens",
        "",
        "Use this for short-video story ideation.",
      ].join("\n"),
      "utf8",
    );

    new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 100,
    }).writeApproved([
      {
        id: "skill.local",
        version: "1.0.0",
        title: "Local",
        content: "Keep me.",
        updatedAtMs: 1,
      },
      {
        id: "external.ref.old",
        version: "1.0.0",
        title: "Old",
        content: "Remove stale import.",
        updatedAtMs: 1,
        metadata: { source: "reference-repository" },
      },
    ]);

    const result = await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "ref", root: repo, includeDirs: ["skills"] }],
      enabledSkillIds: ["external.ref.skills.creative.story"],
      actor: "test",
      nowMs: 200,
    });

    expect(result).toMatchObject({
      scannedCount: 1,
      importedCount: 1,
      enabledCount: 1,
      disabledCount: 0,
    });
    const approved = new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir }),
    ).readApproved();
    expect(approved.map((skill) => skill.id)).toEqual([
      "external.ref.skills.creative.story",
      "skill.local",
    ]);
    expect(
      approved.find((skill) => skill.id === "external.ref.skills.creative.story"),
    ).toMatchObject({
      title: "Story Lens",
      description: "Generate story ideas for short videos.",
      metadata: {
        source: "reference-repository",
        sourceRepo: "ref",
      },
    });
    expect(
      new SkillManagementStore(resolveSkillManagementPath({ dataDir })).isSkillEnabled(
        "external.ref.skills.creative.story",
      ),
    ).toBe(true);
  });

  test("keeps Hermes nested tags and routes ComfyUI-style media skills to production", async () => {
    const root = mkdtempSync(join(tmpdir(), "hotflow-reference-skills-comfyui-"));
    cleanupPaths.push(root);
    const repo = join(root, "hermes-agent");
    const dataDir = join(root, ".hotflow");
    mkdirSync(join(repo, "skills", "creative", "comfyui"), { recursive: true });
    writeFileSync(
      join(repo, "skills", "creative", "comfyui", "SKILL.md"),
      [
        "---",
        "name: comfyui",
        "description: Generate images, video, and audio with ComfyUI.",
        "metadata:",
        "  hermes:",
        "    tags:",
        "      - comfyui",
        "      - image-generation",
        "      - video-generation",
        "    category: creative",
        "---",
        "# ComfyUI",
        "",
        "Use the ComfyUI web UI and REST API to run txt2img workflows.",
      ].join("\n"),
      "utf8",
    );

    await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "hermes-agent", root: repo, includeDirs: ["skills"] }],
      enabledSkillIds: [],
      actor: "test",
      nowMs: 200,
    });

    const skillId = "external.hermes-agent.skills.creative.comfyui";
    const approved = new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir }),
    ).readApproved();
    const imported = approved.find((skill) => skill.id === skillId);
    expect(imported).toMatchObject({
      title: "ComfyUI",
      tags: expect.arrayContaining(["comfyui", "image-generation", "video-generation", "creative"]),
    });

    const taxonomy = await new FileSkillTaxonomyStore({
      skillsDir: join(dataDir, "skills"),
    }).inspectTaxonomy();
    expect(taxonomy.skills.find((skill) => skill.skillId === skillId)).toMatchObject({
      categoryId: "director-production",
      tagIds: expect.arrayContaining(["comfyui", "image-generation", "video-generation"]),
    });
  });

  test("does not import MemPalace as a future reference repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "hotflow-reference-skills-mempalace-"));
    cleanupPaths.push(root);
    const repo = join(root, "mempalace");
    const dataDir = join(root, ".hotflow");
    mkdirSync(join(repo, "codex-plugin", "skills", "search"), { recursive: true });
    writeFileSync(
      join(repo, "codex-plugin", "skills", "search", "SKILL.md"),
      [
        "---",
        "name: search",
        "description: Legacy MemPalace search skill.",
        "---",
        "# Search",
        "",
        "Use MemPalace as a reference memory source.",
      ].join("\n"),
      "utf8",
    );

    const result = await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "mempalace", root: repo, includeDirs: ["codex-plugin/skills"] }],
      enabledSkillIds: ["external.mempalace.codex-plugin.skills.search"],
      actor: "test",
      nowMs: 200,
    });

    expect(result).toMatchObject({
      scannedCount: 0,
      importedCount: 0,
      enabledCount: 0,
      disabledCount: 0,
      skillIds: [],
    });
    expect(
      new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }))
        .readApproved()
        .map((skill) => skill.id),
    ).not.toContain("external.mempalace.codex-plugin.skills.search");
  });

  test("preserves operator enablement and deletion decisions across repeated imports", async () => {
    const root = mkdtempSync(join(tmpdir(), "hotflow-reference-skills-decisions-"));
    cleanupPaths.push(root);
    const repo = join(root, "ref");
    const dataDir = join(root, ".hotflow");
    mkdirSync(join(repo, "skills", "creative", "story"), { recursive: true });
    writeFileSync(
      join(repo, "skills", "creative", "story", "SKILL.md"),
      [
        "---",
        "name: story-lens",
        "description: Generate story ideas for short videos.",
        "---",
        "# Story Lens",
        "",
        "Use this for short-video story ideation.",
      ].join("\n"),
      "utf8",
    );

    await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "ref", root: repo, includeDirs: ["skills"] }],
      enabledSkillIds: ["external.ref.skills.creative.story"],
      actor: "test",
      nowMs: 200,
    });

    const management = new SkillManagementStore(resolveSkillManagementPath({ dataDir }));
    management.setSkillEnabled("external.ref.skills.creative.story", false, {
      actor: "operator",
      note: "keep disabled",
      nowMs: 300,
    });

    await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "ref", root: repo, includeDirs: ["skills"] }],
      enabledSkillIds: ["external.ref.skills.creative.story"],
      actor: "test",
      nowMs: 400,
    });

    expect(
      new SkillManagementStore(resolveSkillManagementPath({ dataDir })).isSkillEnabled(
        "external.ref.skills.creative.story",
      ),
    ).toBe(false);
    expect(
      new SkillManagementStore(resolveSkillManagementPath({ dataDir })).getDecision(
        "external.ref.skills.creative.story",
      ),
    ).toMatchObject({ decidedBy: "operator", note: "keep disabled" });

    management.removeSkill("external.ref.skills.creative.story", {
      actor: "operator",
      nowMs: 500,
    });
    new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })).writeApproved([], {
      changeKind: "manual",
    });

    const result = await importReferenceSkills({
      dataDir,
      repositories: [{ repoId: "ref", root: repo, includeDirs: ["skills"] }],
      enabledSkillIds: ["external.ref.skills.creative.story"],
      actor: "test",
      nowMs: 600,
    });

    expect(result).toMatchObject({
      scannedCount: 1,
      importedCount: 0,
      enabledCount: 0,
      disabledCount: 0,
    });
    expect(
      new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }))
        .readApproved()
        .map((skill) => skill.id),
    ).not.toContain("external.ref.skills.creative.story");
  });
});
