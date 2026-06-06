import { describe, expect, test } from "vitest";

import { analyzeSkillEvolution, guardSkillCuratorWriteRequest } from "../src/index.js";
import type { SkillUsageDocument } from "../src/usage.js";

const usageDocument: SkillUsageDocument = {
  schemaVersion: "skills.usage.v1",
  updatedAtMs: 10_000,
  updatedBy: "test",
  records: {
    "skill.failed": {
      skillId: "skill.failed",
      viewCount: 0,
      useCount: 3,
      failureCount: 2,
      patchCount: 0,
      createdAtMs: 100,
      lastViewedAtMs: null,
      lastUsedAtMs: 700,
      lastFailedAtMs: 800,
      lastPatchedAtMs: null,
      lastActivityAtMs: 800,
      state: "active",
      pinned: false,
      archivedAtMs: null,
      events: [
        {
          action: "use",
          occurredAtMs: 700,
          actor: "runtime",
        },
        {
          action: "failure",
          occurredAtMs: 800,
          actor: "runtime",
          reason: "tool unavailable",
        },
      ],
    },
    "skill.stale": {
      skillId: "skill.stale",
      viewCount: 0,
      useCount: 1,
      failureCount: 0,
      patchCount: 0,
      createdAtMs: 100,
      lastViewedAtMs: null,
      lastUsedAtMs: 200,
      lastFailedAtMs: null,
      lastPatchedAtMs: null,
      lastActivityAtMs: 200,
      state: "active",
      pinned: false,
      archivedAtMs: null,
      events: [],
    },
    "skill.healthy": {
      skillId: "skill.healthy",
      viewCount: 0,
      useCount: 4,
      failureCount: 0,
      patchCount: 1,
      createdAtMs: 100,
      lastViewedAtMs: null,
      lastUsedAtMs: 9_900,
      lastFailedAtMs: null,
      lastPatchedAtMs: 9_000,
      lastActivityAtMs: 9_900,
      state: "active",
      pinned: false,
      archivedAtMs: null,
      events: [],
    },
  },
};

describe("analyzeSkillEvolution", () => {
  test("turns usage evidence into patch, archive, merge, and keep recommendations", () => {
    const result = analyzeSkillEvolution({
      nowMs: 10_000,
      staleAfterMs: 1_000,
      failurePatchThreshold: 2,
      usageDocument,
      approvedSkills: [
        {
          id: "skill.failed",
          version: "1.0.0",
          title: "Failed Skill",
          content: "Use a downstream tool.",
          updatedAtMs: 100,
        },
        {
          id: "skill.stale",
          version: "1.0.0",
          title: "Stale Skill",
          content: "Old workflow.",
          updatedAtMs: 100,
        },
        {
          id: "skill.dup.a",
          version: "1.0.0",
          title: "Duplicate A",
          content: "Same lesson.",
          updatedAtMs: 100,
          metadata: {
            dedupeKey: "same-lesson",
          },
        },
        {
          id: "skill.dup.b",
          version: "1.0.0",
          title: "Duplicate B",
          content: "Same lesson with small wording change.",
          updatedAtMs: 110,
          metadata: {
            dedupeKey: "same-lesson",
          },
        },
        {
          id: "skill.healthy",
          version: "1.0.0",
          title: "Healthy Skill",
          content: "Recently used.",
          updatedAtMs: 100,
        },
      ],
    });

    expect(result.summary).toMatchObject({
      totalSkills: 5,
      patchCount: 1,
      archiveCount: 1,
      mergeCount: 1,
      keepCount: 1,
    });
    expect(result.actions.find((action) => action.kind === "patch")).toMatchObject({
      skillId: "skill.failed",
      severity: "risky",
      evidence: {
        failureCount: 2,
        useCount: 3,
        lastFailedAtMs: 800,
      },
    });
    expect(result.actions.find((action) => action.kind === "archive")).toMatchObject({
      skillId: "skill.stale",
      severity: "warning",
    });
    expect(result.actions.find((action) => action.kind === "merge")).toMatchObject({
      skillId: "skill.dup.a",
      canonicalSkillId: "skill.dup.a",
      duplicateSkillIds: ["skill.dup.b"],
    });
    expect(result.actions.find((action) => action.kind === "keep")).toMatchObject({
      skillId: "skill.healthy",
      severity: "info",
    });
  });
});

describe("guardSkillCuratorWriteRequest", () => {
  test("blocks remote curator writes before any Skill mutation path", () => {
    const result = guardSkillCuratorWriteRequest({
      action: {
        kind: "patch",
        skillId: "skill.failed",
        reason: "failure telemetry crossed threshold",
      },
      operator: {
        actor: "weixin-conversation-runtime",
        surface: "weixin",
        scopes: ["skills.curator.write"],
      },
      nowMs: 12_000,
    });

    expect(result).toMatchObject({
      schemaId: "skills.curator-write-guard.v1",
      allowed: false,
      status: "blocked",
      reasonCode: "remote_surface_blocked",
      requiredScopes: ["skills.curator.write"],
      operatorSurface: "weixin",
      requestedAction: expect.objectContaining({
        kind: "patch",
        skillId: "skill.failed",
      }),
      nextActions: expect.arrayContaining([expect.stringContaining("桌面本地 operator")]),
    });
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        "skill-curator://patch/skill.failed",
        "skills.curator-write-guard://remote-surface-blocked",
      ]),
    );
  });

  test("requires explicit curator write scope even for local desktop operator surfaces", () => {
    const result = guardSkillCuratorWriteRequest({
      action: {
        kind: "archive",
        skillId: "skill.stale",
        reason: "stale skill",
      },
      operator: {
        actor: "desktop-operator",
        surface: "desktop-local",
        scopes: ["skills.read"],
      },
      nowMs: 12_100,
    });

    expect(result).toMatchObject({
      allowed: false,
      status: "operator_scope_required",
      reasonCode: "missing_operator_scope",
      missingScopes: ["skills.curator.write"],
      operatorSurface: "desktop-local",
    });
  });

  test("admits local operator curator writes only with the dedicated write scope", () => {
    const result = guardSkillCuratorWriteRequest({
      action: {
        kind: "merge",
        skillId: "skill.dup.a",
        canonicalSkillId: "skill.dup.a",
        duplicateSkillIds: ["skill.dup.b"],
        reason: "duplicate dedupeKey",
      },
      operator: {
        actor: "desktop-operator",
        surface: "desktop-local",
        scopes: ["skills.curator.write"],
      },
      nowMs: 12_200,
    });

    expect(result).toMatchObject({
      allowed: true,
      status: "allowed",
      reasonCode: "operator_scope_admitted",
      requiredScopes: ["skills.curator.write"],
      operatorSurface: "desktop-local",
      requestedAction: expect.objectContaining({
        kind: "merge",
        skillId: "skill.dup.a",
        duplicateSkillIds: ["skill.dup.b"],
      }),
      nextActions: expect.arrayContaining([expect.stringContaining("执行本地 curator")]),
    });
  });
});
