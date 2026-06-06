import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("FileKnowledgeStore", () => {
  const root = join(tmpdir(), "director-knowledge-test");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seed(stateDir: string, payload: Record<string, unknown>) {
    const dir = join(root, stateDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "record.json"), JSON.stringify(payload));
  }

  it("reads published records", async () => {
    seed("published", {
      id: "pack-a",
      title: "Pack A",
      createdAt: new Date().toISOString(),
      version: 1,
    });
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const published = await store.listPublished();
    expect(published.length).toBe(1);
    expect(published[0].metadata.id).toBe("pack-a");
  });

  it("filters history by pack id", async () => {
    seed("history", {
      id: "pack-b",
      title: "Pack B",
      createdAt: new Date().toISOString(),
      version: 2,
    });
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const history = await store.listHistory("pack-b");
    expect(history.length).toBe(1);
    expect(history[0].metadata.version).toBe(2);
  });

  it("gets candidate if available", async () => {
    seed("candidate", {
      id: "pack-c",
      title: "Pack C",
      createdAt: new Date().toISOString(),
      version: 3,
    });
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const candidate = await store.getCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate?.metadata.id).toBe("pack-c");
  });

  it("publishes an accepted trace proposal into published and history lanes", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    const document = materializeDirectorKnowledgePackFromProposal(createAcceptedProposalFixture(), {
      author: "operator-a",
      note: "publish for beta5",
      now: "2026-04-12T22:10:00.000Z",
    });

    const published = await store.publish(document);
    const current = await store.getPublished(document.metadata.id);
    const history = await store.listHistory(document.metadata.id);

    expect(published.packId).toBe(document.metadata.id);
    expect(published.version).toBe(1);
    expect(current?.metadata.id).toBe(document.metadata.id);
    expect(current?.method.sourceProposalId).toBe("proposal-accepted-1");
    expect(current?.metadata.author).toBe("operator-a");
    expect(history).toHaveLength(1);
    expect(history[0]?.metadata.version).toBe(1);
  });
});

function createAcceptedProposalFixture() {
  return {
    schemaVersion: "director.proposal.v1" as const,
    proposalId: "proposal-accepted-1",
    kind: "director.trace_capture" as const,
    status: "accepted" as const,
    provenance: "director-worker/proposal-ingest",
    recordId: "record-1",
    digestId: "digest-1",
    runId: "run-1",
    reportId: "report-1",
    projectId: "project-1",
    groupId: "group-1",
    title: "Director method: Continuity-safe teaser",
    summary: "completed immersive new run",
    trigger: "When planning a continuity-safe teaser.",
    evidenceSummary: "status=completed | roles=researcher, script-planner",
    explanation: "Completed run suggests a reusable director method.",
    confidence: 0.91,
    riskLevel: "low" as const,
    dedupeKey: "project-1__group-1__continuity-safe-teaser",
    tags: ["director-trace", "continuity"],
    roles: ["researcher", "script-planner"],
    selectedAdapters: ["scripted"],
    createdAt: "2026-04-12T22:00:00.000Z",
    updatedAt: "2026-04-12T22:05:00.000Z",
    latestDecision: {
      decidedAt: "2026-04-12T22:05:00.000Z",
      decidedStatus: "accepted" as const,
      note: "approved_for_publish",
    },
    sourceRecord: {
      schemaVersion: "director.memory.record.v1" as const,
      recordId: "record-1",
      digestId: "digest-1",
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
      tags: ["continuity"],
      status: "completed" as const,
      recordedAt: "2026-04-12T22:00:00.000Z",
      digest: {
        schemaVersion: "director.memory.trace-digest.v1" as const,
        digestId: "digest-1",
        runId: "run-1",
        reportId: "report-1",
        snapshotId: "snapshot-1",
        runtimeId: "runtime-1",
        blueprintId: "blueprint-1",
        handoffId: "handoff-1",
        actionGraphId: "graph-1",
        projectId: "project-1",
        groupId: "group-1",
        goal: "Create a continuity-safe teaser.",
        previewSummary: "Preview-safe run completed successfully.",
        status: "completed" as const,
        roles: ["researcher", "script-planner"],
        anchorIds: ["anchor-a"],
        selectedAdapters: ["scripted"],
        observationRefs: [
          {
            observationId: "observation-evaluation-1",
            source: "evaluation" as const,
            recordedAt: "2026-04-12T22:00:00.000Z",
          },
        ],
        assignmentStats: {
          total: 2,
          completed: 2,
          failed: 0,
          aborted: 0,
          skipped: 0,
          blocked: 0,
        },
        flags: [],
        eventTypes: ["run-created", "assignment-status-changed"],
        createdAt: "2026-04-12T22:00:00.000Z",
        startedAt: "2026-04-12T22:00:00.000Z",
        completedAt: "2026-04-12T22:05:00.000Z",
        recordedAt: "2026-04-12T22:05:00.000Z",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity"],
      },
    },
  };
}
