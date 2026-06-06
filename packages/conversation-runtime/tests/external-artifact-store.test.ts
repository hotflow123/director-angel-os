import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFileConversationRuntimeExternalArtifactStore } from "../src/index.js";

describe("conversation runtime external artifact store", () => {
  it("persists external tool artifacts with lifecycle metadata for readback", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-external-artifacts-"));
    try {
      const store = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 10_000,
        defaultTtlMs: 86_400_000,
      });

      const written = store.upsertArtifacts({
        providerId: "moyin",
        toolId: "moyin.provider",
        operationId: "workflow-run.artifacts",
        turnId: "turn-1",
        sessionKey: "desktop:workbench",
        runId: "run-1",
        projectId: "project-1",
        artifacts: [
          {
            id: "image:../cover",
            kind: "image",
            path: "/tmp/moyin/run-1/cover.png",
            metadata: {
              provider: "moyin",
              role: "cover",
              stepId: "step-1",
              sensitivity: "internal",
            },
          },
        ],
      });
      const reloaded = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 10_100,
      });

      expect(written).toMatchObject({
        status: "ok",
        artifactIds: ["image:../cover"],
      });
      expect(reloaded.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
        expect.objectContaining({
          artifactId: "image:../cover",
          kind: "image",
          providerId: "moyin",
          toolId: "moyin.provider",
          operationId: "workflow-run.artifacts",
          turnId: "turn-1",
          sessionKey: "desktop:workbench",
          projectId: "project-1",
          runId: "run-1",
          localPath: "/tmp/moyin/run-1/cover.png",
          createdAtMs: 10_000,
          expiresAtMs: 86_410_000,
          retention: "ephemeral",
          sensitivity: "internal",
          cleanupPolicyRef: "artifactPolicy.external.ephemeral",
          metadata: expect.objectContaining({
            role: "cover",
            stepId: "step-1",
          }),
        }),
      ]);
      expect(reloaded.listTombstones()).toEqual([]);
      expect(reloaded.readArtifact("image:../cover")?.storageRef.relativePath).not.toContain("..");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expires only ephemeral artifacts and keeps tombstones for run-center audit", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-external-artifacts-retention-"));
    try {
      const store = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 1_000,
        defaultTtlMs: 500,
      });
      store.upsertArtifacts({
        providerId: "moyin",
        toolId: "moyin.provider",
        operationId: "artifact.list",
        artifacts: [
          {
            id: "expired-image",
            kind: "image",
            path: "/tmp/moyin/expired.png",
            metadata: { projectId: "project-1" },
          },
          {
            id: "keep-workflow",
            kind: "workflow",
            path: "/tmp/moyin/workflow.json",
            metadata: {
              projectId: "project-1",
              retention: "persistent",
            },
          },
        ],
      });

      const pruned = store.pruneExpiredArtifacts({ nowMs: 2_000 });

      expect(pruned).toMatchObject({
        expiredArtifactIds: ["expired-image"],
        retainedArtifactIds: ["keep-workflow"],
      });
      expect(store.readArtifact("expired-image")).toBeUndefined();
      expect(store.readArtifact("keep-workflow")).toMatchObject({
        artifactId: "keep-workflow",
        retention: "persistent",
      });
      expect(store.listTombstones()).toEqual([
        expect.objectContaining({
          artifactId: "expired-image",
          reason: "expired",
          deletedAtMs: 2_000,
          previousRecord: expect.objectContaining({
            artifactId: "expired-image",
            localPath: "/tmp/moyin/expired.png",
          }),
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
