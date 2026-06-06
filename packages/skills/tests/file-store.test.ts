import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION,
  SkillManagementStore,
  SkillSnapshotFileStore,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("SkillSnapshotFileStore", () => {
  test("reads empty approved skill snapshots when the file is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    const store = new SkillSnapshotFileStore(filePath);

    expect(store.readApproved()).toEqual([]);
  });

  test("writes and reads approved skill snapshots", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    const store = new SkillSnapshotFileStore(filePath, {
      now: () => 200,
    });

    store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README, then summarize the repository.",
        updatedAtMs: 100,
        tags: ["summary", "readme"],
        disableModelInvocation: true,
      },
    ]);

    expect(store.readApproved()).toEqual([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README, then summarize the repository.",
        updatedAtMs: 100,
        tags: ["summary", "readme"],
        disableModelInvocation: true,
      },
    ]);
    expect(store.readHead()).toMatchObject({
      version: 1,
      previousVersion: null,
      appliedFromProposalId: null,
      changeKind: "manual",
    });
  });

  test("preserves versioned history across approved snapshot writes", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    let currentNow = 200;
    const store = new SkillSnapshotFileStore(filePath, {
      now: () => currentNow,
    });

    const firstWrite = store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README, then summarize the repository.",
        updatedAtMs: 100,
      },
    ]);

    currentNow = 300;
    const secondWrite = store.writeApproved(
      [
        {
          id: "skill.readme-summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README, then summarize the repository clearly.",
          updatedAtMs: 120,
        },
        {
          id: "skill.issue-triage",
          version: "1.0.0",
          title: "Issue Triage",
          content: "Inspect the issue and summarize likely next steps.",
          updatedAtMs: 130,
        },
      ],
      {
        appliedFromProposalId: "proposal_2",
      },
    );

    expect(firstWrite).toMatchObject({
      version: 1,
      previousVersion: null,
    });
    expect(secondWrite).toMatchObject({
      version: 2,
      previousVersion: 1,
      appliedFromProposalId: "proposal_2",
      changeKind: "apply",
    });
    expect(store.readHead()).toMatchObject({
      version: 2,
      previousVersion: 1,
      appliedFromProposalId: "proposal_2",
    });
    expect(store.readVersion(1)?.skills).toHaveLength(1);
    expect(store.listHistory().map((entry) => entry.version)).toEqual([1, 2]);
  });

  test("restores a previous approved snapshot as a new head version", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    let currentNow = 200;
    const store = new SkillSnapshotFileStore(filePath, {
      now: () => currentNow,
    });

    store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README, then summarize the repository.",
        updatedAtMs: 100,
      },
    ]);

    currentNow = 300;
    store.writeApproved(
      [
        {
          id: "skill.readme-summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README, then summarize the repository clearly.",
          updatedAtMs: 120,
        },
        {
          id: "skill.issue-triage",
          version: "1.0.0",
          title: "Issue Triage",
          content: "Inspect the issue and summarize likely next steps.",
          updatedAtMs: 130,
        },
      ],
      {
        appliedFromProposalId: "proposal_2",
      },
    );

    currentNow = 400;
    const restored = store.restoreApprovedVersion(1);

    expect(restored).toMatchObject({
      version: 3,
      previousVersion: 2,
      restoredFromVersion: 1,
      changeKind: "rollback",
    });
    expect(store.readApproved().map((entry) => entry.id)).toEqual(["skill.readme-summary"]);
    expect(store.listHistory().map((entry) => entry.version)).toEqual([1, 2, 3]);
  });

  test("recovers the previous head after a failed apply write", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    let currentNow = 200;
    const store = new SkillSnapshotFileStore(filePath, {
      now: () => currentNow,
    });

    store.writeApproved([
      {
        id: "skill.readme-summary",
        version: "1.0.0",
        title: "README Summary",
        content: "Read the README, then summarize the repository.",
        updatedAtMs: 100,
      },
    ]);

    const previousHead = store.readHead();
    currentNow = 300;
    const failedWrite = store.writeApproved(
      [
        {
          id: "skill.readme-summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README carefully, then summarize the repository clearly.",
          updatedAtMs: 120,
        },
      ],
      {
        appliedFromProposalId: "proposal_failed",
      },
    );

    store.recoverHead(previousHead, failedWrite.version);

    expect(store.readHead()).toMatchObject({
      version: 1,
      previousVersion: null,
      appliedFromProposalId: null,
    });
    expect(store.readVersion(2)).toBeNull();
  });

  test("removes the first head entirely when recovering a failed initial apply", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    const store = new SkillSnapshotFileStore(filePath, {
      now: () => 200,
    });

    const failedWrite = store.writeApproved(
      [
        {
          id: "skill.readme-summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read the README, then summarize the repository.",
          updatedAtMs: 100,
        },
      ],
      {
        appliedFromProposalId: "proposal_failed",
      },
    );

    store.recoverHead(null, failedWrite.version);

    expect(store.readHead()).toBeNull();
    expect(store.readVersion(1)).toBeNull();
  });

  test("rejects invalid approved snapshot documents", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, "skills"), { recursive: true });
    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          schemaVersion: APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION,
          updatedAtMs: 100,
          skills: [{ id: "broken-skill" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new SkillSnapshotFileStore(filePath);
    expect(() => store.readApproved()).toThrow("Invalid approved skill snapshot document");
  });

  test("reads legacy v1 approved snapshot documents and upgrades them in memory", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-store-"));
    cleanupPaths.push(workspaceRoot);

    mkdirSync(join(workspaceRoot, "skills"), { recursive: true });
    const filePath = join(workspaceRoot, "skills", "approved-skills.json");
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          schemaVersion: "skills.approved.v1",
          updatedAtMs: 100,
          skills: [
            {
              id: "skill.legacy-summary",
              version: "1.0.0",
              title: "Legacy Summary",
              content: "Support the legacy format.",
              updatedAtMs: 50,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const store = new SkillSnapshotFileStore(filePath);
    expect(store.readHead()).toMatchObject({
      version: 1,
      previousVersion: null,
      changeKind: "manual",
      appliedFromProposalId: null,
    });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
      schemaVersion: "skills.approved.v1",
    });
  });

  test("resolves the approved skill snapshot path from config or env override", () => {
    expect(
      resolveApprovedSkillSnapshotPath(
        { dataDir: "/workspace/.hotflow" },
        { HOTFLOW_SKILLS_SNAPSHOT_PATH: "/tmp/skills.json" },
      ),
    ).toBe("/tmp/skills.json");

    expect(resolveApprovedSkillSnapshotPath({ dataDir: "/workspace/.hotflow" })).toBe(
      "/workspace/.hotflow/skills/approved-skills.json",
    );
  });
});

describe("SkillManagementStore", () => {
  test("persists enabled overrides separately from approved snapshots", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-management-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "management.json");
    const store = new SkillManagementStore(filePath, {
      now: () => 500,
    });

    expect(store.isSkillEnabled("skill.external")).toBe(true);

    const disabled = store.setSkillEnabled("skill.external", false, {
      actor: "desktop",
      note: "pause risky external skill",
    });
    expect(disabled).toMatchObject({
      skillId: "skill.external",
      enabled: false,
      decidedAtMs: 500,
      decidedBy: "desktop",
      note: "pause risky external skill",
    });
    expect(store.isSkillEnabled("skill.external")).toBe(false);
    expect(store.readDocument().disabledSkillIds).toEqual(["skill.external"]);

    const enabled = store.setSkillEnabled("skill.external", true, {
      actor: "desktop",
    });
    expect(enabled).toMatchObject({
      skillId: "skill.external",
      enabled: true,
      decidedBy: "desktop",
    });
    expect(store.isSkillEnabled("skill.external")).toBe(true);
    expect(store.readDocument().disabledSkillIds).toEqual([]);
  });

  test("removes enablement decisions for deleted skills", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-management-"));
    cleanupPaths.push(workspaceRoot);

    const filePath = join(workspaceRoot, "skills", "management.json");
    const store = new SkillManagementStore(filePath, {
      now: () => 600,
    });

    store.setSkillEnabled("skill.external", false, { actor: "desktop" });
    store.setSkillEnabled("skill.other", false, { actor: "desktop" });
    const document = store.removeSkill("skill.external", { actor: "desktop" });

    expect(document.disabledSkillIds).toEqual(["skill.other"]);
    expect(document.removedSkillIds).toEqual(["skill.external"]);
    expect(document.decisions.map((decision) => decision.skillId)).toContain("skill.other");
    expect(document.decisions.map((decision) => decision.skillId)).not.toContain("skill.external");
    expect(store.isSkillEnabled("skill.external")).toBe(true);
  });

  test("resolves the default management path under dataDir skills", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skills-management-"));
    cleanupPaths.push(workspaceRoot);

    expect(resolveSkillManagementPath({ dataDir: join(workspaceRoot, ".hotflow") })).toBe(
      join(workspaceRoot, ".hotflow", "skills", "management.json"),
    );
  });
});
