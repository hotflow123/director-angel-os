import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLearningArtifactStore,
  createPendingLearningArtifactFromResult,
  persistAcceptedLearningConfirmationToRepository,
  readLearningCandidates,
} from "../src/index.js";

const originalHotflowDataDir = process.env.HOTFLOW_DATA_DIR;
const tempRoots: string[] = [];

afterEach(() => {
  if (originalHotflowDataDir === undefined) {
    process.env.HOTFLOW_DATA_DIR = undefined;
  } else {
    process.env.HOTFLOW_DATA_DIR = originalHotflowDataDir;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function useTempDataDir(): void {
  const tempRoot = mkdtempSync(join(tmpdir(), "conversation-runtime-learning-persistence-"));
  tempRoots.push(tempRoot);
  process.env.HOTFLOW_DATA_DIR = join(tempRoot, ".hotflow");
}

describe("learning confirmation repository persistence", () => {
  it("persists accepted learning confirmations as reviewed repository candidates", async () => {
    useTempDataDir();
    const store = createLearningArtifactStore({ nowMs: () => 1_000 });
    const created = createPendingLearningArtifactFromResult({
      store,
      sessionKey: "desktop:workbench",
      turnRunId: "turn-learn-url",
      sourceSurface: "desktop",
      sourceKind: "url",
      sourceRef: "https://x.com/example/status/1",
      observedAtMs: 1_000,
      result: {
        result: {
          candidateCount: 1,
          candidateIds: ["exp-prompt-safety"],
        },
        candidates: [
          {
            candidateId: "exp-prompt-safety",
            title: "GPT Image 提示词安全表达",
            summary: "把低俗直白词改成更稳定的审美表达，并保留场景边界。",
            tags: ["提示词", "图像生成"],
          },
        ],
      },
    });

    expect(created.confirmation).toBeDefined();
    const resolution = store.resolvePendingConfirmation({
      text: "可以保存为经验库",
      sessionKey: "desktop:workbench",
      messageId: "message-save",
      nowMs: 1_500,
    });
    if (resolution.decision.kind !== "accept" || !resolution.artifact || !resolution.confirmation) {
      throw new Error("Expected an accepted learning confirmation.");
    }

    const persisted = await persistAcceptedLearningConfirmationToRepository({
      dataDir: process.env.HOTFLOW_DATA_DIR,
      input: {
        text: "可以保存为经验库",
        sessionKey: "desktop:workbench",
        channel: "desktop",
        surface: "desktop",
        messageId: "message-save",
      },
      turnId: "turn-save",
      decision: resolution.decision,
      artifact: resolution.artifact,
      confirmation: resolution.confirmation,
    });

    expect(persisted).toMatchObject({
      status: "review-required",
      candidateIds: ["exp-prompt-safety"],
    });
    expect(persisted.message).toContain("待审经验候选");

    const candidates = readLearningCandidates({ dataDir: process.env.HOTFLOW_DATA_DIR }).candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      itemId: "exp-prompt-safety",
      revisionId: "turn-learn-url",
      title: "GPT Image 提示词安全表达",
      stage: "reviewed",
      metadata: expect.objectContaining({
        sourceRef: "https://x.com/example/status/1",
        confirmationId: resolution.confirmation.confirmationId,
      }),
    });
  });
});
