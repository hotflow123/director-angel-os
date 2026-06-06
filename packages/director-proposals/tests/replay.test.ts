import { describe, expect, it } from "vitest";

import { materializeDirectorTraceProposalReplay } from "../src/replay.js";
import type { DirectorTraceProposal } from "../src/types.js";

describe("materializeDirectorTraceProposalReplay", () => {
  it("builds a mock-only synthetic blueprint from an accepted proposal", () => {
    const materialized = materializeDirectorTraceProposalReplay(createProposalFixture(), {
      now: "2026-04-12T21:30:00.000Z",
    });

    expect(materialized.previewId).toBe("trace-proposal-preview-proposal-1");
    expect(materialized.summary).toContain("accepted trace proposal");
    expect(materialized.warnings).toContain(
      "Synthetic replay derived from a trace digest, not the original host blueprint.",
    );
    expect(materialized.blueprint.blueprintId).toBe("trace-proposal-replay-proposal-1");
    expect(materialized.blueprint.preview.summary).toContain("mock-only rehearsal");
    expect(materialized.blueprint.handoff.sideEffectsAllowed).toBe(false);
    expect(materialized.blueprint.actionGraph.nodes.map((node) => node.role)).toEqual([
      "researcher",
      "script-planner",
    ]);
    expect(materialized.blueprint.actionGraph.nodes[0]).toMatchObject({
      assignmentId: "trace-proposal-replay-proposal-1-assignment-1",
      actionClass: "read",
      approvalMode: "auto_allow",
      selectedAdapter: "scripted",
    });
    expect(materialized.blueprint.actionGraph.nodes[1]).toMatchObject({
      dependsOn: ["trace-proposal-replay-proposal-1-assignment-1"],
      actionClass: "write",
    });
    expect(materialized.blueprint.capabilitySnapshot.adapters[0]).toMatchObject({
      adapterId: "scripted",
      adapterKind: "execution",
      enabled: true,
      dryRunSupported: true,
      mockOnly: true,
    });
  });

  it("rejects non-accepted proposals", () => {
    expect(() =>
      materializeDirectorTraceProposalReplay(createProposalFixture({ status: "pending" })),
    ).toThrow(/accepted/i);
  });
});

function createProposalFixture(
  overrides: Partial<DirectorTraceProposal> = {},
): DirectorTraceProposal {
  return {
    schemaVersion: "director.proposal.v1",
    proposalId: "proposal-1",
    kind: "director.trace_capture",
    status: "accepted",
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
    confidence: 0.88,
    riskLevel: "low",
    dedupeKey: "project-1__group-1",
    tags: ["director-trace", "continuity"],
    roles: ["researcher", "script-planner"],
    selectedAdapters: ["scripted"],
    createdAt: "2026-04-12T21:00:00.000Z",
    updatedAt: "2026-04-12T21:10:00.000Z",
    latestDecision: {
      decidedAt: "2026-04-12T21:10:00.000Z",
      decidedStatus: "accepted",
      note: "approved_for_reuse",
    },
    sourceRecord: {
      schemaVersion: "director.memory.record.v1",
      recordId: "record-1",
      digestId: "digest-1",
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
      tags: ["continuity"],
      status: "completed",
      recordedAt: "2026-04-12T21:00:00.000Z",
      digest: {
        schemaVersion: "director.memory.trace-digest.v1",
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
        status: "completed",
        roles: ["researcher", "script-planner"],
        anchorIds: ["anchor-a"],
        selectedAdapters: ["scripted"],
        observationRefs: [
          {
            observationId: "observation-evaluation-1",
            source: "evaluation",
            recordedAt: "2026-04-12T21:00:00.000Z",
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
        createdAt: "2026-04-12T21:00:00.000Z",
        startedAt: "2026-04-12T21:00:00.000Z",
        completedAt: "2026-04-12T21:05:00.000Z",
        recordedAt: "2026-04-12T21:05:00.000Z",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity"],
      },
    },
    ...overrides,
  };
}
