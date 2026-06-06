import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  SkillCuratorAutoApplyService,
  SkillSnapshotFileStore,
  SkillUsageStore,
  guardSkillCuratorWriteRequest,
  resolveApprovedSkillSnapshotPath,
  resolveSkillUsagePath,
} from "../src/index.js";

describe("SkillCuratorAutoApplyService", () => {
  test("refuses remote curator patch apply before mutating approved Skills", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hotflow-skill-curator-remote-"));
    try {
      const snapshotStore = new SkillSnapshotFileStore(
        resolveApprovedSkillSnapshotPath({ dataDir }),
      );
      snapshotStore.writeApproved([
        {
          id: "skill.failed",
          version: "1.0.0",
          title: "Failed Skill",
          content: "Old unsafe guidance.",
          updatedAtMs: 100,
        },
      ]);
      const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
        now: () => 200,
      });
      usageStore.recordFailure("skill.failed", { actor: "runtime", nowMs: 200 });

      const guard = guardSkillCuratorWriteRequest({
        action: { kind: "patch", skillId: "skill.failed" },
        operator: {
          surface: "weixin",
          scopes: ["skills.curator.write"],
        },
        nowMs: 300,
      });
      const result = new SkillCuratorAutoApplyService(snapshotStore, usageStore).apply({
        action: { kind: "patch", skillId: "skill.failed" },
        guard,
        patch: {
          content: "New local-only guidance.",
          version: "1.0.1",
        },
        operator: {
          actor: "weixin-runtime",
          surface: "weixin",
        },
        nowMs: 400,
      });

      expect(result).toMatchObject({
        schemaId: "skills.curator-auto-apply.v1",
        applied: false,
        status: "blocked",
        reasonCode: "guard_not_allowed",
      });
      expect(snapshotStore.readApproved()[0]).toMatchObject({
        id: "skill.failed",
        version: "1.0.0",
        content: "Old unsafe guidance.",
      });
      expect(usageStore.readRecord("skill.failed")?.failureCount).toBe(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("applies a concrete local operator patch and clears curator failure evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hotflow-skill-curator-local-"));
    try {
      const snapshotStore = new SkillSnapshotFileStore(
        resolveApprovedSkillSnapshotPath({ dataDir }),
      );
      snapshotStore.writeApproved([
        {
          id: "skill.failed",
          version: "1.0.0",
          title: "Failed Skill",
          content: "Old brittle workflow.",
          tags: ["old"],
          updatedAtMs: 100,
          metadata: {
            dedupeKey: "failed-skill",
          },
        },
      ]);
      const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
        now: () => 200,
      });
      usageStore.recordFailure("skill.failed", { actor: "runtime", nowMs: 200 });
      usageStore.recordFailure("skill.failed", { actor: "runtime", nowMs: 250 });

      const guard = guardSkillCuratorWriteRequest({
        action: {
          kind: "patch",
          skillId: "skill.failed",
          reason: "failure telemetry crossed threshold",
        },
        operator: {
          actor: "desktop-operator",
          surface: "desktop-local",
          scopes: ["skills.curator.write"],
        },
        nowMs: 300,
      });
      const result = new SkillCuratorAutoApplyService(snapshotStore, usageStore).apply({
        action: {
          kind: "patch",
          skillId: "skill.failed",
          reason: "failure telemetry crossed threshold",
        },
        guard,
        patch: {
          content: "Updated robust workflow with explicit fallback and verification.",
          tags: ["old", "patched"],
          version: "1.0.1",
        },
        operator: {
          actor: "desktop-operator",
          surface: "desktop-local",
          note: "reviewed patch candidate",
        },
        nowMs: 400,
      });

      expect(result).toMatchObject({
        schemaId: "skills.curator-auto-apply.v1",
        applied: true,
        status: "applied",
        reasonCode: "patch_applied",
        action: expect.objectContaining({
          kind: "patch",
          skillId: "skill.failed",
        }),
        guard: expect.objectContaining({
          allowed: true,
          reasonCode: "operator_scope_admitted",
        }),
      });
      expect(snapshotStore.readApproved()[0]).toMatchObject({
        id: "skill.failed",
        version: "1.0.1",
        content: "Updated robust workflow with explicit fallback and verification.",
        tags: ["old", "patched"],
        metadata: expect.objectContaining({
          dedupeKey: "failed-skill",
          curatorAutoAppliedAtMs: 400,
          curatorAutoAppliedBy: "desktop-operator",
          curatorPatchNote: "reviewed patch candidate",
          curatorGuardEvidenceRefs: expect.arrayContaining([
            "skills.curator-write-guard://operator-scope-admitted",
          ]),
        }),
      });
      const usage = usageStore.readRecord("skill.failed");
      expect(usage?.failureCount).toBe(0);
      expect(usage?.patchCount).toBe(1);
      expect(result.evidenceRefs).toEqual(
        expect.arrayContaining([
          "skill-curator://patch/skill.failed",
          "skills.curator-auto-apply://patch/skill.failed",
        ]),
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
