import { describe, expect, test } from "vitest";

import { generateDirectorProposalFromRecord } from "../src/generator.js";
import { reviewDirectorTraceProposal } from "../src/review.js";

describe("reviewDirectorTraceProposal", () => {
  test("recommends accept for low-risk, high-confidence proposals", () => {
    const review = reviewDirectorTraceProposal(
      generateDirectorProposalFromRecord({
        record: createRecord(),
        provenance: "director-worker/proposal-ingest",
        now: "2026-04-12T12:00:00.000Z",
      }),
    );

    expect(review.recommendation).toBe("accept");
    expect(review.reasons.join(" ")).toMatch(/Risk is low/i);
  });

  test("recommends reject for high-risk proposals", () => {
    const review = reviewDirectorTraceProposal(
      generateDirectorProposalFromRecord({
        record: createRecord({
          status: "failed",
          digest: {
            flags: ["has-failures"],
          },
        }),
        provenance: "director-worker/proposal-ingest",
        now: "2026-04-12T12:00:00.000Z",
      }),
    );

    expect(review.recommendation).toBe("reject");
    expect(review.riskLevel).toBe("high");
  });
});

function createRecord(
  overrides: {
    readonly status?: "completed" | "failed";
    readonly digest?: {
      readonly flags?: readonly string[];
    };
  } = {},
) {
  return {
    schemaVersion: "director.memory.record.v1" as const,
    recordId: "record-run-1",
    digestId: "digest-run-1",
    projectId: "project-1",
    groupId: "group-1",
    anchorIds: ["anchor-a"],
    selectedAdapters: ["seedance"],
    status: overrides.status ?? "completed",
    recordedAt: "2026-04-12T10:00:00.000Z",
    digest: {
      schemaVersion: "director.memory.trace-digest.v1" as const,
      digestId: "digest-run-1",
      runId: "run-1",
      reportId: "report-run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      projectId: "project-1",
      groupId: "group-1",
      goal: "Create a continuity-safe teaser.",
      previewSummary: "Preview-safe teaser plan.",
      status: overrides.status ?? "completed",
      roles: ["researcher"],
      anchorIds: ["anchor-a"],
      selectedAdapters: ["seedance"],
      observationRefs: [
        {
          observationId: "observation-evaluation-1",
          source: "evaluation" as const,
          recordedAt: "2026-04-12T09:59:00.000Z",
        },
      ],
      assignmentStats: {
        total: 1,
        completed: 1,
        failed: 0,
        aborted: 0,
        skipped: 0,
        blocked: 0,
      },
      flags: overrides.digest?.flags ?? [],
      eventTypes: ["run-created"],
      createdAt: "2026-04-12T09:58:00.000Z",
      recordedAt: "2026-04-12T10:00:00.000Z",
    },
  };
}
