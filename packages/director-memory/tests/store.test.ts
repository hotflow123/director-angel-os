import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDirectorTraceDigest } from "@hotflow/director-memory-contracts";

import {
  DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS,
  FileSystemDirectorMemoryStore,
  NoopDirectorMemoryPort,
} from "../src/index.js";

describe("director-memory", () => {
  it("returns disabled semantics for the noop memory port", async () => {
    const memory = new NoopDirectorMemoryPort({
      clock: () => "2026-04-12T12:00:00.000Z",
    });

    const writeResult = await memory.writeRecord(createRecord({ recordId: "record-noop" }));
    const recallResult = await memory.recall({
      projectId: "project-1",
      maxHits: 3,
    });
    const status = await memory.getStatus();

    expect(writeResult.status).toBe("disabled");
    expect(recallResult.status).toBe("disabled");
    expect(recallResult.hits).toEqual([]);
    expect(status.status).toBe("disabled");
    expect(status.recordCount).toBe(0);
  });

  it("writes records and reports status from the filesystem store", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-store-"));
    const store = new FileSystemDirectorMemoryStore({
      rootPath,
      clock: () => "2026-04-12T12:00:00.000Z",
    });

    const first = createRecord({
      recordId: "record-1",
      recordedAt: "2026-04-12T10:00:00.000Z",
      digestOverrides: {
        groupId: "group-a",
      },
    });
    const second = createRecord({
      recordId: "record-2",
      recordedAt: "2026-04-12T11:00:00.000Z",
      digestOverrides: {
        groupId: "group-b",
      },
    });

    await store.writeRecord(first);
    await store.writeRecord(second);
    const status = await store.getStatus();

    expect(status.status).toBe("ok");
    expect(status.recordCount).toBe(2);
    expect(status.lastRecordedAt).toBe("2026-04-12T11:00:00.000Z");
    expect(status.rootPath).toBe(rootPath);

    const indexPath = join(rootPath, "index.json");
    const recordsDir = join(rootPath, "records");
    const indexDocument = JSON.parse(await readFile(indexPath, "utf8")) as {
      entries: Array<{ recordId: string }>;
    };

    expect(indexDocument.entries.map((entry) => entry.recordId)).toEqual(["record-2", "record-1"]);
    expect(JSON.parse(await readFile(join(recordsDir, "record-1.json"), "utf8"))).toMatchObject({
      recordId: "record-1",
    });
  });

  it("recalls records with deterministic, explainable ranking and maxHits", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-recall-"));
    const store = new FileSystemDirectorMemoryStore({
      rootPath,
      clock: () => "2026-04-12T12:00:00.000Z",
      scoringWeights: {
        ...DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS,
        recencyMaxAgeDays: 30,
        recencyMaxBoost: 3,
      },
    });

    await store.writeRecord(
      createRecord({
        recordId: "record-best",
        recordedAt: "2026-04-11T12:00:00.000Z",
        tags: ["continuity", "hero"],
        digestOverrides: {
          groupId: "group-a",
          anchorIds: ["anchor-a", "anchor-b"],
          selectedAdapters: ["adapter-a"],
          generationStyle: "immersive",
          knowledgeSignalTags: ["continuity", "hero"],
        },
      }),
    );
    await store.writeRecord(
      createRecord({
        recordId: "record-second",
        recordedAt: "2026-03-30T12:00:00.000Z",
        tags: ["continuity"],
        digestOverrides: {
          groupId: "group-a",
          anchorIds: ["anchor-a"],
          selectedAdapters: ["adapter-z"],
          generationStyle: "immersive",
          knowledgeSignalTags: ["continuity"],
        },
      }),
    );
    await store.writeRecord(
      createRecord({
        recordId: "record-other-project",
        recordedAt: "2026-04-11T12:00:00.000Z",
        digestOverrides: {
          projectId: "project-other",
          groupId: "group-a",
          anchorIds: ["anchor-a"],
          selectedAdapters: ["adapter-a"],
        },
      }),
    );

    const packet = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a", "anchor-b"],
      selectedAdapters: ["adapter-a"],
      generationStyle: "immersive",
      knowledgeSignalTags: ["continuity"],
      maxHits: 2,
    });

    expect(packet.status).toBe("ok");
    expect(packet.hits).toHaveLength(2);
    expect(packet.hits.map((hit) => hit.recordId)).toEqual(["record-best", "record-second"]);
    expect(packet.hits[0]?.reasons).toContain("projectId matched");
    expect(packet.hits[0]?.reasons).toContain("groupId matched");
    expect(packet.hits[0]?.reasons).toContain("2 anchorIds matched");
    expect(packet.hits[0]?.reasons).toContain("selectedAdapters matched");
    expect(packet.hits[0]?.reasons).toContain("knowledgeSignalTags matched");
    expect(packet.hits[0]?.score).toBeGreaterThan(packet.hits[1]?.score ?? 0);
    expect(packet.truncated).toBe(false);
  });

  it("keeps memory candidates review-gated and recalls published memory with evidence refs", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-candidate-"));
    const store = new FileSystemDirectorMemoryStore({
      rootPath,
      clock: () => "2026-04-12T12:00:00.000Z",
    });
    const candidate = {
      candidateId: "memory-candidate-1",
      record: createRecord({
        recordId: "record-candidate-1",
        recordedAt: "2026-04-11T12:00:00.000Z",
        tags: ["continuity", "review-gated"],
        digestOverrides: {
          groupId: "group-a",
          anchorIds: ["anchor-a"],
          knowledgeSignalTags: ["continuity"],
        },
      }),
      evidenceRefs: [
        {
          evidenceId: "source-evidence-1",
          sourceKind: "url",
          sourceRef: "https://example.test/lesson",
          sourceSnapshotId: "artifact-lesson-1",
          summary: "Readable source captured for review.",
        },
      ],
      summary: "候选记忆：连续性锚点要保留。",
      createdAt: "2026-04-11T12:00:00.000Z",
    };

    await store.writeCandidate(candidate);
    const beforePublish = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });
    const publishResult = await store.publishCandidate("memory-candidate-1", {
      actor: "operator",
      note: "accepted after source review",
      publishedAt: "2026-04-12T12:01:00.000Z",
    });
    const afterPublish = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });

    expect(beforePublish.status).toBe("miss");
    expect(beforePublish.hits).toHaveLength(0);
    expect(publishResult.status).toBe("ok");
    expect(publishResult.recordId).toBe("record-candidate-1");
    expect(afterPublish.status).toBe("ok");
    expect(afterPublish.hits[0]).toMatchObject({
      recordId: "record-candidate-1",
      summary: "候选记忆：连续性锚点要保留。",
      evidenceRefs: [
        {
          evidenceId: "source-evidence-1",
          sourceKind: "url",
          sourceRef: "https://example.test/lesson",
          sourceSnapshotId: "artifact-lesson-1",
        },
      ],
      publication: {
        candidateId: "memory-candidate-1",
        actor: "operator",
        note: "accepted after source review",
      },
    });
  });

  it("governs published memory with retract, quarantine, demote, and restore", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-governance-"));
    const store = new FileSystemDirectorMemoryStore({
      rootPath,
      clock: () => "2026-04-12T12:00:00.000Z",
    });
    const candidate = {
      candidateId: "memory-candidate-governed",
      record: createRecord({
        recordId: "record-governed",
        recordedAt: "2026-04-11T12:00:00.000Z",
        tags: ["continuity"],
        digestOverrides: {
          groupId: "group-a",
          anchorIds: ["anchor-a"],
          knowledgeSignalTags: ["continuity"],
        },
      }),
      evidenceRefs: [
        {
          evidenceId: "source-evidence-governed",
          sourceKind: "tool-result",
          sourceRef: "tool://web_extract/tool-1",
          summary: "Tool result reviewed by operator.",
        },
      ],
      summary: "治理测试记忆。",
      createdAt: "2026-04-11T12:00:00.000Z",
    };

    await store.writeCandidate(candidate);
    await store.publishCandidate(candidate.candidateId, {
      actor: "operator",
      publishedAt: "2026-04-12T12:01:00.000Z",
    });

    const demoted = await store.demotePublication("record-governed", {
      actor: "operator",
      note: "source is useful but weak",
      decidedAt: "2026-04-12T12:02:00.000Z",
    });
    const demotedRecall = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });
    const quarantined = await store.quarantinePublication("record-governed", {
      actor: "operator",
      reason: "privacy-risk",
      decidedAt: "2026-04-12T12:03:00.000Z",
    });
    const quarantinedRecall = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });
    const restored = await store.restorePublication("record-governed", {
      actor: "operator",
      note: "manual review passed",
      decidedAt: "2026-04-12T12:04:00.000Z",
    });
    const restoredRecall = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });
    const retracted = await store.retractPublication("record-governed", {
      actor: "operator",
      reason: "wrong-source",
      decidedAt: "2026-04-12T12:05:00.000Z",
    });
    const retractedRecall = await store.recall({
      projectId: "project-1",
      groupId: "group-a",
      anchorIds: ["anchor-a"],
      maxHits: 3,
    });

    expect(demoted.status).toBe("ok");
    expect(demoted.recordId).toBe("record-governed");
    expect(demoted.governanceStatus).toBe("demoted");
    expect(demotedRecall.status).toBe("ok");
    expect(demotedRecall.hits[0]).toMatchObject({
      recordId: "record-governed",
      governance: {
        status: "demoted",
        audit: [
          expect.objectContaining({
            actor: "operator",
            previousStatus: "published",
            nextStatus: "demoted",
          }),
        ],
      },
    });
    expect(demotedRecall.hits[0]?.reasons).toContain("memory demoted by governance");

    expect(quarantined.status).toBe("ok");
    expect(quarantined.governanceStatus).toBe("quarantined");
    expect(quarantinedRecall.status).toBe("miss");
    expect(quarantinedRecall.hits).toHaveLength(0);

    expect(restored.status).toBe("ok");
    expect(restored.governanceStatus).toBe("published");
    expect(restoredRecall.status).toBe("ok");
    expect(restoredRecall.hits[0]?.governance?.status).toBe("published");

    expect(retracted.status).toBe("ok");
    expect(retracted.governanceStatus).toBe("retracted");
    expect(retractedRecall.status).toBe("miss");
    expect(retractedRecall.hits).toHaveLength(0);
  });

  it("degrades safely when the index document is corrupted", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-corrupt-"));
    await mkdir(rootPath, { recursive: true });
    await writeFile(join(rootPath, "index.json"), "{not-json", "utf8");

    const store = new FileSystemDirectorMemoryStore({
      rootPath,
      clock: () => "2026-04-12T12:00:00.000Z",
    });

    const packet = await store.recall({
      projectId: "project-1",
      maxHits: 3,
    });
    const status = await store.getStatus();

    expect(packet.status).toBe("degraded");
    expect(packet.hits).toEqual([]);
    expect(packet.notes.join(" ")).toMatch(/index/i);
    expect(status.status).toBe("degraded");
    expect(status.notes.join(" ")).toMatch(/index/i);
  });
});

function createRecord(input: {
  recordId: string;
  recordedAt?: string;
  tags?: readonly string[];
  digestOverrides?: Record<string, unknown>;
}) {
  const digest = buildDirectorTraceDigest({
    digestId: `digest-${input.recordId}`,
    recordedAt: input.recordedAt ?? "2026-04-12T10:00:00.000Z",
    report: createExecutionRunReport(input.digestOverrides ?? {}),
    projectId:
      typeof input.digestOverrides?.projectId === "string"
        ? input.digestOverrides.projectId
        : "project-1",
    groupId:
      typeof input.digestOverrides?.groupId === "string"
        ? input.digestOverrides.groupId
        : "group-1",
    anchorIds: Array.isArray(input.digestOverrides?.anchorIds)
      ? (input.digestOverrides.anchorIds as string[])
      : ["anchor-a"],
    selectedAdapters: Array.isArray(input.digestOverrides?.selectedAdapters)
      ? (input.digestOverrides.selectedAdapters as string[])
      : ["adapter-a"],
    ...(typeof input.digestOverrides?.generationType === "string"
      ? { generationType: input.digestOverrides.generationType as string }
      : {}),
    ...(typeof input.digestOverrides?.generationStyle === "string"
      ? { generationStyle: input.digestOverrides.generationStyle as string }
      : {}),
    ...(Array.isArray(input.digestOverrides?.knowledgeSignalTags)
      ? { knowledgeSignalTags: input.digestOverrides.knowledgeSignalTags as string[] }
      : {}),
  });

  return {
    schemaVersion: "director.memory.record.v1" as const,
    recordId: input.recordId,
    digestId: digest.digestId,
    projectId: digest.projectId,
    groupId: digest.groupId,
    anchorIds: digest.anchorIds,
    selectedAdapters: digest.selectedAdapters,
    ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
    status: digest.status,
    recordedAt: input.recordedAt ?? digest.recordedAt,
    digest,
  };
}

function createExecutionRunReport(overrides: Record<string, unknown>) {
  const now = "2026-04-12T09:59:00.000Z";

  return {
    schemaVersion: "director.execution.run.v1" as const,
    reportId: "report-1",
    runId: "run-1",
    run: {
      schemaVersion: "director.execution.run.v1" as const,
      runId: "run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      goal: "Create a launch teaser.",
      previewSummary: "Director approved a preview-safe run.",
      createdAt: "2026-04-12T09:50:00.000Z",
      startedAt: "2026-04-12T09:51:00.000Z",
      updatedAt: now,
      completedAt: now,
      status: "completed" as const,
      assignments: [
        {
          runId: "run-1",
          assignmentId: "assignment-a",
          role: "researcher" as const,
          objective: "Inspect the brief.",
          deliverable: "Research brief",
          actionClass: "read" as const,
          approvalMode: "auto_allow" as const,
          dependsOn: [],
          status: "completed" as const,
          selectedAdapter: "adapter-a",
          createdAt: "2026-04-12T09:50:00.000Z",
          completedAt: "2026-04-12T09:54:00.000Z",
          result: {
            runId: "run-1",
            assignmentId: "assignment-a",
            status: "completed" as const,
            recordedAt: "2026-04-12T09:54:00.000Z",
            workerId: "worker-1",
            summary: "Research completed.",
            adapterId: "adapter-a",
          },
        },
      ],
      events: [
        {
          eventId: "event-1",
          runId: "run-1",
          type: "run-created" as const,
          occurredAt: "2026-04-12T09:50:00.000Z",
          message: "Run created.",
        },
      ],
    },
    recordedAt: now,
    summary: ["1 assignment reached a terminal state."],
    flags: ["preview-only"],
    events: [
      {
        eventId: "event-1",
        runId: "run-1",
        type: "run-created" as const,
        occurredAt: "2026-04-12T09:50:00.000Z",
        message: "Run created.",
      },
    ],
    ...overrides,
  };
}
