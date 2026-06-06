import type { ExecutionRunReport } from "@hotflow/director-execution-contracts";

import {
  DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION,
  DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
  DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION,
  buildDirectorTraceDigest,
  isDirectorMemoryRecord,
  isDirectorRecallPacket,
  isDirectorTerminalRunStatus,
  isDirectorTraceDigest,
} from "../src/index.js";

describe("director-memory-contracts", () => {
  it("recognizes terminal run statuses", () => {
    expect(isDirectorTerminalRunStatus("completed")).toBe(true);
    expect(isDirectorTerminalRunStatus("failed")).toBe(true);
    expect(isDirectorTerminalRunStatus("aborted")).toBe(true);
    expect(isDirectorTerminalRunStatus("running")).toBe(false);
  });

  it("rejects non-terminal execution reports when building a trace digest", () => {
    const report = createExecutionRunReport({
      run: createExecutionRun({
        status: "running",
      }),
    });

    expect(() =>
      buildDirectorTraceDigest({
        digestId: "digest-running",
        recordedAt: "2026-04-12T10:00:00.000Z",
        report,
        projectId: "project-1",
        groupId: "group-1",
      }),
    ).toThrow(/terminal/i);
  });

  it("builds a deterministic trace digest from a terminal execution report", () => {
    const report = createExecutionRunReport();
    const input = {
      digestId: "digest-1",
      recordedAt: "2026-04-12T10:00:00.000Z",
      report,
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-b", "anchor-a", "anchor-a"],
      selectedAdapters: ["adapter-z", "adapter-a", "adapter-z"],
      observationRefs: [
        {
          observationId: "obs-outcome",
          source: "outcome" as const,
          recordedAt: "2026-04-12T09:59:00.000Z",
        },
        {
          observationId: "obs-eval",
          source: "evaluation" as const,
          recordedAt: "2026-04-12T09:58:00.000Z",
        },
        {
          observationId: "obs-eval",
          source: "evaluation" as const,
          recordedAt: "2026-04-12T09:58:00.000Z",
        },
      ],
      generationType: "video",
      generationStyle: "immersive",
      knowledgeSignalTags: ["continuity", "style", "continuity"],
    };

    const left = buildDirectorTraceDigest(input);
    const right = buildDirectorTraceDigest(input);

    expect(left).toEqual(right);
    expect(left.schemaVersion).toBe(DIRECTOR_TRACE_DIGEST_SCHEMA_VERSION);
    expect(left.status).toBe("completed");
    expect(left.roles).toEqual(["researcher", "shot-planner"]);
    expect(left.anchorIds).toEqual(["anchor-a", "anchor-b"]);
    expect(left.selectedAdapters).toEqual(["adapter-a", "adapter-b", "adapter-z"]);
    expect(left.knowledgeSignalTags).toEqual(["continuity", "style"]);
    expect(left.observationRefs).toEqual([
      {
        observationId: "obs-eval",
        source: "evaluation",
        recordedAt: "2026-04-12T09:58:00.000Z",
      },
      {
        observationId: "obs-outcome",
        source: "outcome",
        recordedAt: "2026-04-12T09:59:00.000Z",
      },
    ]);
    expect(left.assignmentStats).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      aborted: 0,
      skipped: 0,
      blocked: 0,
    });
    expect(isDirectorTraceDigest(left)).toBe(true);
  });

  it("validates memory record and recall packet shapes", () => {
    const digest = buildDirectorTraceDigest({
      digestId: "digest-1",
      recordedAt: "2026-04-12T10:00:00.000Z",
      report: createExecutionRunReport(),
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["adapter-a"],
    });

    const record = {
      schemaVersion: DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION,
      recordId: "record-1",
      digestId: digest.digestId,
      projectId: digest.projectId,
      groupId: digest.groupId,
      anchorIds: digest.anchorIds,
      selectedAdapters: digest.selectedAdapters,
      tags: ["continuity", "video"],
      status: digest.status,
      recordedAt: "2026-04-12T10:01:00.000Z",
      digest,
    };

    const packet = {
      schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
      queryId: "query-1",
      status: "ok" as const,
      recordedAt: "2026-04-12T10:02:00.000Z",
      notes: ["1 hit returned."],
      hits: [
        {
          recordId: "record-1",
          digestId: digest.digestId,
          projectId: "project-1",
          groupId: "group-1",
          anchorIds: ["anchor-a"],
          selectedAdapters: ["adapter-a"],
          status: "completed" as const,
          recordedAt: "2026-04-12T10:01:00.000Z",
          score: 0.91,
          reasons: ["anchorIds matched", "same projectId"],
          summary: "Previous run succeeded with the same continuity anchor.",
          provenance: {
            runId: digest.runId,
            reportId: digest.reportId,
            observationIds: digest.observationRefs.map((ref) => ref.observationId),
          },
          evidenceRefs: [
            {
              evidenceId: "source-evidence-1",
              sourceKind: "url",
              sourceRef: "https://example.test/lesson",
              sourceSnapshotId: "artifact-lesson-1",
              summary: "Readable source captured for review.",
            },
          ],
          publication: {
            candidateId: "memory-candidate-1",
            publishedAt: "2026-04-12T10:01:30.000Z",
            actor: "operator",
            note: "accepted after source review",
          },
        },
      ],
      query: {
        projectId: "project-1",
        groupId: "group-1",
        anchorIds: ["anchor-a"],
        maxHits: 3,
      },
      truncated: false,
    };

    expect(isDirectorMemoryRecord(record)).toBe(true);
    expect(isDirectorRecallPacket(packet)).toBe(true);
  });
});

function createExecutionRunReport(overrides: Partial<ExecutionRunReport> = {}): ExecutionRunReport {
  const run = overrides.run ?? createExecutionRun();
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-1",
    runId: run.runId,
    run,
    recordedAt: "2026-04-12T09:59:30.000Z",
    summary: ["2 assignments reached a terminal state."],
    flags: ["preview-only"],
    events: run.events,
    ...overrides,
  };
}

function createExecutionRun(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    runId: "run-1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    actionGraphId: "graph-1",
    goal: "Create an immersive launch teaser.",
    previewSummary: "Director approved a preview-safe video teaser run.",
    createdAt: "2026-04-12T09:50:00.000Z",
    startedAt: "2026-04-12T09:51:00.000Z",
    updatedAt: "2026-04-12T09:59:00.000Z",
    completedAt: "2026-04-12T09:59:00.000Z",
    status: "completed",
    assignments: [
      {
        runId: "run-1",
        assignmentId: "assignment-a",
        role: "researcher",
        objective: "Inspect the locked brief.",
        deliverable: "Research brief",
        actionClass: "read",
        approvalMode: "auto_allow",
        dependsOn: [],
        status: "completed",
        selectedAdapter: "adapter-b",
        createdAt: "2026-04-12T09:50:00.000Z",
        completedAt: "2026-04-12T09:54:00.000Z",
        result: {
          runId: "run-1",
          assignmentId: "assignment-a",
          status: "completed",
          recordedAt: "2026-04-12T09:54:00.000Z",
          workerId: "worker-1",
          summary: "Research completed.",
          adapterId: "adapter-b",
        },
      },
      {
        runId: "run-1",
        assignmentId: "assignment-b",
        role: "shot-planner",
        objective: "Produce the shot list.",
        deliverable: "Shot plan",
        actionClass: "write",
        approvalMode: "auto_allow",
        dependsOn: ["assignment-a"],
        status: "failed",
        selectedAdapter: "adapter-a",
        createdAt: "2026-04-12T09:54:00.000Z",
        completedAt: "2026-04-12T09:59:00.000Z",
        result: {
          runId: "run-1",
          assignmentId: "assignment-b",
          status: "failed",
          recordedAt: "2026-04-12T09:59:00.000Z",
          workerId: "worker-1",
          summary: "Shot planning failed due to missing references.",
          adapterId: "adapter-a",
        },
      },
    ],
    events: [
      {
        eventId: "event-1",
        runId: "run-1",
        type: "run-created",
        occurredAt: "2026-04-12T09:50:00.000Z",
        message: "Run created.",
      },
      {
        eventId: "event-2",
        runId: "run-1",
        type: "assignment-status-changed",
        occurredAt: "2026-04-12T09:54:00.000Z",
        message: "Research assignment completed.",
        metadata: {
          assignmentId: "assignment-a",
          status: "completed",
        },
      },
      {
        eventId: "event-3",
        runId: "run-1",
        type: "assignment-status-changed",
        occurredAt: "2026-04-12T09:59:00.000Z",
        message: "Shot planning failed.",
        metadata: {
          assignmentId: "assignment-b",
          status: "failed",
        },
      },
    ],
    ...overrides,
  };
}
