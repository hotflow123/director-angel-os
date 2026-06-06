import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import { buildDirectorTraceDigest } from "@hotflow/director-memory-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { describeDirectorMemoryStatus, previewDirectorMemoryRecall } from "./director-memory.js";

describe("director memory helpers", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("describes switch state, store state, and latest ingest audit", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-memory-status-"));
    tempRoots.push(workspaceRoot);
    const memoryRoot = join(workspaceRoot, ".director-angel", "runtime", "memory");
    const ingestRoot = join(memoryRoot, "ingest");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T18:00:00.000Z",
    });

    await store.writeRecord(createMemoryRecord("record-status"));
    mkdirSync(ingestRoot, { recursive: true });
    writeFileSync(
      join(ingestRoot, "run-status.json"),
      JSON.stringify({
        schemaVersion: "director.memory.ingest.audit.v1",
        runId: "run-status",
        reportId: "report-status",
        status: "ok",
        recordedAt: "2026-04-12T18:00:00.000Z",
        observationIds: ["observation-evaluation-1"],
        notes: ["Stored Director memory record record-status."],
        recordId: "record-status",
        digestId: "digest-record-status",
      }),
      "utf8",
    );
    writeFileSync(
      join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "memory.enabled": true,
        },
      }),
      "utf8",
    );

    const output = await describeDirectorMemoryStatus(workspaceRoot);

    expect(output).toContain("Director memory:");
    expect(output).toContain("enabled: yes");
    expect(output).toContain("record count: 1");
    expect(output).toContain("latest ingest: ok");
    expect(output).toContain("record-status");
  });

  it("renders a recall preview with why-recalled reasons and provenance", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-memory-preview-"));
    tempRoots.push(workspaceRoot);
    const memoryRoot = join(workspaceRoot, ".director-angel", "runtime", "memory");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T18:10:00.000Z",
    });

    await store.writeRecord(createMemoryRecord("record-preview"));
    writeFileSync(
      join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "memory.enabled": true,
        },
      }),
      "utf8",
    );

    const output = await previewDirectorMemoryRecall(workspaceRoot, {
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
      generationType: "new",
      generationStyle: "immersive",
      knowledgeSignalTags: ["continuity"],
      maxHits: 1,
    });

    expect(output).toContain("Director memory recall preview:");
    expect(output).toContain("status: ok");
    expect(output).toContain("truncated: no");
    expect(output).toContain("why recalled:");
    expect(output).toContain("projectId matched");
    expect(output).toContain("provenance:");
    expect(output).toContain("run=run-record-preview");
  });
});

function createMemoryRecord(recordId: string) {
  const digest = buildDirectorTraceDigest({
    digestId: `digest-${recordId}`,
    recordedAt: "2026-04-12T17:59:00.000Z",
    report: {
      schemaVersion: "director.execution.run.v1",
      reportId: `report-${recordId}`,
      runId: `run-${recordId}`,
      recordedAt: "2026-04-12T17:59:00.000Z",
      summary: ["run status=completed"],
      flags: ["preview-only"],
      run: {
        schemaVersion: "director.execution.run.v1",
        runId: `run-${recordId}`,
        snapshotId: `snapshot-${recordId}`,
        runtimeId: "runtime-1",
        blueprintId: `blueprint-${recordId}`,
        handoffId: `handoff-${recordId}`,
        actionGraphId: `graph-${recordId}`,
        goal: "Create a continuity-safe teaser.",
        previewSummary: "Preview-safe run completed successfully.",
        createdAt: "2026-04-12T17:50:00.000Z",
        startedAt: "2026-04-12T17:51:00.000Z",
        updatedAt: "2026-04-12T17:59:00.000Z",
        completedAt: "2026-04-12T17:59:00.000Z",
        status: "completed",
        assignments: [
          {
            runId: `run-${recordId}`,
            assignmentId: "assignment-router",
            role: "asset-router",
            objective: "Select the best adapter route.",
            deliverable: "Adapter route",
            actionClass: "route",
            approvalMode: "operator_approve",
            dependsOn: [],
            status: "completed",
            selectedAdapter: "scripted",
            createdAt: "2026-04-12T17:50:00.000Z",
            startedAt: "2026-04-12T17:52:00.000Z",
            completedAt: "2026-04-12T17:54:00.000Z",
            attempts: 1,
            result: {
              artifactIds: ["artifact-route"],
              notes: ["Selected a continuity-safe adapter route."],
              adapterId: "scripted",
            },
          },
        ],
        events: [
          {
            eventId: `event-${recordId}`,
            runId: `run-${recordId}`,
            type: "assignment.completed",
            timestamp: "2026-04-12T17:54:00.000Z",
            payload: {
              adapterId: "scripted",
            },
          },
        ],
      },
      events: [],
    },
    projectId: "project-1",
    groupId: "group-1",
    anchorIds: ["anchor-a"],
    selectedAdapters: ["scripted"],
    observationRefs: [
      {
        observationId: "observation-evaluation-1",
        source: "evaluation",
        recordedAt: "2026-04-12T17:49:00.000Z",
      },
    ],
    generationType: "new",
    generationStyle: "immersive",
    knowledgeSignalTags: ["continuity"],
  });

  return {
    schemaVersion: "director.memory.record.v1" as const,
    recordId,
    digestId: digest.digestId,
    projectId: digest.projectId,
    groupId: digest.groupId,
    anchorIds: digest.anchorIds,
    selectedAdapters: digest.selectedAdapters,
    tags: ["continuity"],
    status: digest.status,
    recordedAt: digest.recordedAt,
    digest,
  };
}
