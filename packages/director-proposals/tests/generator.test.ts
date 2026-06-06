import type { DirectorMemoryRecord } from "@hotflow/director-memory-contracts";
import { describe, expect, test } from "vitest";

import { generateDirectorProposalFromRecord } from "../src/generator.js";

describe("generateDirectorProposalFromRecord", () => {
  test("creates a deterministic proposal from a completed memory record", () => {
    const record = createRecord();

    const left = generateDirectorProposalFromRecord({
      record,
      provenance: "director-worker/proposal-ingest",
      now: "2026-04-12T12:00:00.000Z",
    });
    const right = generateDirectorProposalFromRecord({
      record,
      provenance: "director-worker/proposal-ingest",
      now: "2026-04-12T12:00:00.000Z",
    });

    expect(left).toEqual(right);
    expect(left.status).toBe("pending");
    expect(left.riskLevel).toBe("low");
    expect(left.confidence).toBeGreaterThan(0.8);
    expect(left.dedupeKey).toContain("project-1");
    expect(left.tags).toContain("director-trace");
  });

  test("marks failed runs as higher risk with lower confidence", () => {
    const proposal = generateDirectorProposalFromRecord({
      record: createRecord({
        status: "failed",
        digest: {
          flags: ["has-failures"],
        },
      }),
      provenance: "director-worker/proposal-ingest",
      now: "2026-04-12T12:00:00.000Z",
    });

    expect(proposal.riskLevel).toBe("high");
    expect(proposal.confidence).toBeLessThan(0.6);
  });
});

function createRecord(
  overrides: Partial<DirectorMemoryRecord> & {
    readonly digest?: Partial<DirectorMemoryRecord["digest"]>;
  } = {},
): DirectorMemoryRecord {
  return {
    schemaVersion: "director.memory.record.v1",
    recordId: overrides.recordId ?? "record-run-1",
    digestId: overrides.digestId ?? "digest-run-1",
    projectId: overrides.projectId ?? "project-1",
    groupId: overrides.groupId ?? "group-1",
    anchorIds: overrides.anchorIds ?? ["anchor-a"],
    selectedAdapters: overrides.selectedAdapters ?? ["seedance"],
    tags: overrides.tags ?? ["continuity"],
    status: overrides.status ?? "completed",
    recordedAt: overrides.recordedAt ?? "2026-04-12T10:00:00.000Z",
    digest: {
      schemaVersion: "director.memory.trace-digest.v1",
      digestId: overrides.digest?.digestId ?? overrides.digestId ?? "digest-run-1",
      runId: overrides.digest?.runId ?? "run-1",
      reportId: overrides.digest?.reportId ?? "report-run-1",
      snapshotId: overrides.digest?.snapshotId ?? "snapshot-1",
      runtimeId: overrides.digest?.runtimeId ?? "runtime-1",
      blueprintId: overrides.digest?.blueprintId ?? "blueprint-1",
      handoffId: overrides.digest?.handoffId ?? "handoff-1",
      actionGraphId: overrides.digest?.actionGraphId ?? "graph-1",
      projectId: overrides.digest?.projectId ?? overrides.projectId ?? "project-1",
      groupId: overrides.digest?.groupId ?? overrides.groupId ?? "group-1",
      goal: overrides.digest?.goal ?? "Create a continuity-safe teaser.",
      previewSummary: overrides.digest?.previewSummary ?? "Preview-safe teaser plan.",
      status: overrides.digest?.status ?? overrides.status ?? "completed",
      roles: overrides.digest?.roles ?? ["researcher", "script-planner"],
      anchorIds: overrides.digest?.anchorIds ?? overrides.anchorIds ?? ["anchor-a"],
      selectedAdapters: overrides.digest?.selectedAdapters ??
        overrides.selectedAdapters ?? ["seedance"],
      observationRefs: overrides.digest?.observationRefs ?? [
        {
          observationId: "observation-evaluation-1",
          source: "evaluation",
          recordedAt: "2026-04-12T09:59:00.000Z",
        },
        {
          observationId: "observation-outcome-1",
          source: "outcome",
          recordedAt: "2026-04-12T10:01:00.000Z",
        },
      ],
      assignmentStats: overrides.digest?.assignmentStats ?? {
        total: 5,
        completed: 5,
        failed: 0,
        aborted: 0,
        skipped: 0,
        blocked: 0,
      },
      flags: overrides.digest?.flags ?? [],
      eventTypes: overrides.digest?.eventTypes ?? ["run-created", "assignment-status-changed"],
      createdAt: overrides.digest?.createdAt ?? "2026-04-12T09:58:00.000Z",
      startedAt: overrides.digest?.startedAt ?? "2026-04-12T09:58:10.000Z",
      completedAt: overrides.digest?.completedAt ?? "2026-04-12T10:00:00.000Z",
      recordedAt: overrides.digest?.recordedAt ?? "2026-04-12T10:00:00.000Z",
      generationType: overrides.digest?.generationType ?? "new",
      generationStyle: overrides.digest?.generationStyle ?? "immersive",
      knowledgeSignalTags: overrides.digest?.knowledgeSignalTags ?? ["continuity"],
    },
  };
}
