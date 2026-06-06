import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readKnowledgeHistory } from "../src/knowledge/repository.js";
import {
  harvestLearningCandidate,
  markLearningCandidatePublishReady,
  promoteLearningCandidate,
  readLearningCandidates,
  readLearningEvents,
  reviewLearningCandidate,
} from "../src/learning/repository.js";

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
  const tempRoot = mkdtempSync(join(tmpdir(), "conversation-runtime-learning-"));
  tempRoots.push(tempRoot);
  process.env.HOTFLOW_DATA_DIR = join(tempRoot, ".hotflow");
}

function buildKnowledgeBundle(revisionId = "rev-0001") {
  return {
    bundleId: "director-prompt-pack",
    itemId: "director-prompt-pack",
    revisionId,
    title: "Director Prompt Pack",
    description: "Reusable director prompt knowledge.",
    adapterId: "director-prompt-adapter",
    modelAdapterId: "seedance-2.0",
    executionProfileIds: ["seedance20-standard"],
    status: "draft",
    source: "external",
    tags: ["visual-grammar"],
    metadata: {
      evidence: [{ label: "source", url: "https://example.test/source" }],
    },
    fieldSchema: [],
    layers: [
      {
        id: "system-base",
        label: "System Base",
        category: "system",
        description: "Base system layer.",
        directives: ["Keep director decisions traceable."],
      },
      {
        id: "visual-grammar",
        label: "Visual Grammar",
        category: "format",
        description: "Visual grammar layer.",
        directives: ["Prefer concrete shot structure."],
      },
    ],
    defaultUserLayerIds: ["visual-grammar"],
    inferenceRules: [],
    template: {
      header: "Director knowledge",
      body: "{{DIRECTOR_VISIBLE_PROMPT}}",
    },
    publishedAt: "2026-05-23T00:00:00.000Z",
  };
}

describe("learning repository", () => {
  it("tracks harvested reviewed publish-ready lifecycle and events", () => {
    useTempDataDir();
    const bundle = buildKnowledgeBundle();

    const harvested = harvestLearningCandidate({
      bundle,
      actor: "learner",
      notes: ["initial data"],
    });
    expect(harvested.candidate.stage).toBe("harvested");

    const reviewed = reviewLearningCandidate({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      actor: "reviewer",
      notes: ["ready for publish", "ready for publish"],
    });
    expect(reviewed.candidate.stage).toBe("reviewed");
    expect(reviewed.candidate.notes.filter((note) => note === "ready for publish")).toEqual([
      "ready for publish",
    ]);

    const ready = markLearningCandidatePublishReady({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      actor: "publisher",
      notes: ["promote"],
    });
    expect(ready.candidate.stage).toBe("publish-ready");

    expect(readLearningCandidates().candidates).toMatchObject([
      { itemId: bundle.itemId, revisionId: bundle.revisionId, stage: "publish-ready" },
    ]);
    expect(readLearningEvents().events.map((event) => event.type)).toEqual([
      "harvested",
      "reviewed",
      "publish-ready",
    ]);
  });

  it("promotes publish-ready candidates into knowledge draft history", () => {
    useTempDataDir();
    const bundle = buildKnowledgeBundle("rev-promote-0001");

    harvestLearningCandidate({ bundle, actor: "learner" });
    reviewLearningCandidate({ itemId: bundle.itemId, revisionId: bundle.revisionId });
    markLearningCandidatePublishReady({ itemId: bundle.itemId, revisionId: bundle.revisionId });

    const promoted = promoteLearningCandidate({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      actor: "bridge",
    });

    expect(promoted.imported.item.status).toBe("draft");
    expect(promoted.imported.revision.revisionId).toBe(bundle.revisionId);

    const history = readKnowledgeHistory({ itemId: bundle.itemId, includeEvents: true });
    expect(history.item?.latestRevisionId).toBe(bundle.revisionId);
    expect(history.revisions[0]?.status).toBe("draft");
    expect(history.events.map((event) => event.type)).toContain("imported");
  });
});
