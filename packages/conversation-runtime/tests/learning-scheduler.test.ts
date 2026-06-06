import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConversationRuntimePromptKnowledgeBundle } from "../src/knowledge/repository.js";
import { readLearningCandidates } from "../src/learning/repository.js";
import {
  listLearningJobs,
  runLearningSchedulerCycle,
  upsertLearningJob,
} from "../src/learning/scheduler.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "conversation-runtime-learning-scheduler-"));
  tempRoots.push(root);
  return root;
}

function buildBundle(revisionId = "learn-0001"): ConversationRuntimePromptKnowledgeBundle {
  return {
    bundleId: "learning-task-pack",
    itemId: "learning-task-pack",
    revisionId,
    title: "Learning Task Pack",
    description: "Scheduler harvested learning candidate.",
    adapterId: "conversation-runtime-learning",
    modelAdapterId: "director-angel",
    executionProfileIds: ["director-angel-learning"],
    status: "draft",
    source: "external",
    tags: ["scheduler"],
    metadata: { sourceRef: "https://example.test/learning" },
    fieldSchema: [],
    layers: [
      {
        id: "reviewed-learning",
        label: "Reviewed Learning",
        category: "custom",
        description: "Scheduler learning layer.",
        directives: ["Keep scheduler candidates review-gated."],
      },
    ],
    defaultUserLayerIds: ["reviewed-learning"],
    inferenceRules: [],
    template: {
      header: "Learning Task Pack",
      body: "Keep scheduler candidates review-gated.",
    },
    publishedAt: "2026-05-23T00:00:00.000Z",
  };
}

function readJsonLines(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("learning scheduler", () => {
  it("records failed task when bundle is missing", () => {
    const root = createTempRoot();
    const configDir = join(root, "scheduler-missing");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "tasks.json");
    const candidateStorePath = join(root, "candidates.jsonl");
    writeFileSync(
      configPath,
      JSON.stringify([{ id: "missing", bundlePath: "./does-not-exist.json" }]),
      "utf8",
    );

    const result = runLearningSchedulerCycle({
      configPath,
      candidateStorePath,
      dataDir: join(root, ".hotflow"),
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ status: "failed" });
    expect(readJsonLines(candidateStorePath)[0]).toMatchObject({
      taskId: "missing",
      status: "failed",
    });
  });

  it("harvests candidate and writes candidate store entry", () => {
    const root = createTempRoot();
    const configDir = join(root, "scheduler-success");
    mkdirSync(configDir, { recursive: true });
    const bundle = buildBundle();
    const bundlePath = join(configDir, "learning-task.json");
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
    const configPath = join(configDir, "tasks.json");
    const dataDir = join(root, ".hotflow");
    const candidateStorePath = join(root, "candidates.jsonl");
    writeFileSync(
      configPath,
      JSON.stringify([
        {
          id: "learning-task",
          bundlePath: "./learning-task.json",
          actor: "auto-learner",
          note: "auto harvest",
        },
      ]),
      "utf8",
    );

    const result = runLearningSchedulerCycle({ configPath, candidateStorePath, dataDir });

    expect(result.tasks[0]).toMatchObject({
      status: "harvested",
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
    });
    expect(readLearningCandidates({ dataDir }).candidates[0]).toMatchObject({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      stage: "harvested",
    });
    expect(readJsonLines(candidateStorePath).at(-1)).toMatchObject({
      status: "harvested",
      bundleId: bundle.bundleId,
      note: "auto harvest",
    });
  });

  it("supports job upsert/list and skips disabled jobs", () => {
    const root = createTempRoot();
    const configPath = join(root, "tasks.json");

    const upserted = upsertLearningJob(
      {
        jobId: "disabled-learning-task",
        bundlePath: "./disabled.json",
        enabled: false,
        actor: "tester",
        note: "disabled for now",
      },
      { configPath, dataDir: join(root, ".hotflow") },
    );

    expect(upserted.job.enabled).toBe(false);
    expect(listLearningJobs({ configPath }).jobs).toMatchObject([
      { jobId: "disabled-learning-task" },
    ]);
    expect(runLearningSchedulerCycle({ configPath }).tasks[0]).toMatchObject({
      status: "skipped",
    });
  });
});
