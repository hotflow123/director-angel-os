import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";

import { ExecutionRunBuilder } from "../src/builder.ts";
import { createDeterministicMockExecutor } from "../src/mock-executor.ts";
import { ExecutionRunService } from "../src/service.ts";
import { FileSystemRunStore } from "../src/store.ts";
import { runExecutionWorkerLoop } from "../src/worker-loop.ts";

describe("director execution worker loop", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "director-execution-worker-loop-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("claims and completes bounded ready assignments until the run is complete", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T02:00:01.000Z",
      "2026-04-12T02:00:02.000Z",
      "2026-04-12T02:00:03.000Z",
      "2026-04-12T02:00:04.000Z",
      "2026-04-12T02:00:05.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const report = await runExecutionWorkerLoop({
      service,
      runId: "run-1",
      workerId: "worker-loop",
      executor: createDeterministicMockExecutor({
        now: (() => {
          const timestamps = ["2026-04-12T02:00:03.000Z", "2026-04-12T02:00:05.000Z"];
          return () => timestamps.shift() ?? "2026-04-12T02:00:06.000Z";
        })(),
      }),
      maxClaims: 4,
    });

    expect(report).toMatchObject({
      schemaVersion: "director-execution.worker-loop.v1",
      runId: "run-1",
      workerId: "worker-loop",
      status: "completed",
      claimedCount: 2,
      completedCount: 2,
      failedCount: 0,
      stoppedReason: "run-terminal",
      assignmentIds: ["assignment-1", "assignment-2"],
    });
    expect((await service.getRun("run-1"))?.status).toBe("completed");
  });

  it("stops after maxClaims without pretending queued work is done", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T02:10:01.000Z",
      "2026-04-12T02:10:02.000Z",
      "2026-04-12T02:10:03.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const report = await runExecutionWorkerLoop({
      service,
      runId: "run-1",
      workerId: "worker-loop",
      executor: createDeterministicMockExecutor({
        now: () => "2026-04-12T02:10:03.000Z",
      }),
      maxClaims: 1,
    });

    const run = await service.getRun("run-1");

    expect(report).toMatchObject({
      status: "stopped",
      claimedCount: 1,
      completedCount: 1,
      stoppedReason: "max-claims",
      assignmentIds: ["assignment-1"],
    });
    expect(run?.status).toBe("running");
    expect(
      run?.assignments.find((assignment) => assignment.assignmentId === "assignment-2")?.status,
    ).toBe("ready");
  });

  it("does not claim work while the run is paused", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T02:20:01.000Z",
      "2026-04-12T02:20:02.000Z",
      "2026-04-12T02:20:03.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.pauseRun("run-1");

    const report = await runExecutionWorkerLoop({
      service,
      runId: "run-1",
      workerId: "worker-loop",
      executor: createDeterministicMockExecutor(),
      maxClaims: 2,
    });

    expect(report).toMatchObject({
      status: "stopped",
      claimedCount: 0,
      completedCount: 0,
      stoppedReason: "run-paused",
    });
    expect((await service.getRun("run-1"))?.status).toBe("paused");
  });
});

function createService(workspaceRoot: string, timestamps: string[]) {
  let eventCounter = 0;
  const store = new FileSystemRunStore({ rootPath: workspaceRoot });
  return new ExecutionRunService({
    store,
    builder: new ExecutionRunBuilder({
      idProvider: () => "run-1",
      clock: () => "2026-04-12T00:00:00.000Z",
    }),
    eventIdProvider: () => `worker-loop-event-${++eventCounter}`,
    clock: () => timestamps.shift() ?? "2026-04-12T02:59:59.000Z",
  });
}

function createBlueprintFixture(): DirectorBlueprintResponse {
  return {
    apiVersion: "director-host-api.v1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    review: {
      overallDecision: "pass",
      blockingReasons: [],
      requiredFixes: [],
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-1",
      runtimeId: "runtime-1",
      capturedAt: "2026-04-12T00:00:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    actionGraph: {
      graphId: "graph-1",
      blueprintId: "blueprint-1",
      goal: "deliver preview",
      nodes: [
        {
          nodeId: "node-1",
          assignmentId: "assignment-1",
          role: "researcher",
          objective: "Inspect the brief",
          inputs: ["snapshot"],
          outputs: ["research brief"],
          deliverable: "prepare outline",
          acceptanceCriteria: ["Goal is explicit."],
          constraints: [],
          dependsOn: [],
          allowedAdapters: ["mock-execution"],
          actionClass: "read",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
        {
          nodeId: "node-2",
          assignmentId: "assignment-2",
          role: "script-planner",
          objective: "Draft the shot plan",
          inputs: ["research brief"],
          outputs: ["shot plan"],
          deliverable: "draft shot plan",
          acceptanceCriteria: ["Plan is deterministic."],
          constraints: [],
          dependsOn: ["assignment-1"],
          allowedAdapters: ["mock-execution"],
          actionClass: "write",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
      ],
      edges: [],
      stopConditions: [],
    },
    preview: {
      previewId: "preview-1",
      summary: "preview",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: [],
    },
    handoff: {
      handoffId: "handoff-1",
      blueprintId: "blueprint-1",
      createdAt: "2026-04-12T00:00:00.000Z",
      alignmentLockId: "lock-1",
      actionGraphId: "graph-1",
      previewSummary: "preview",
      capabilityMatches: [],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: ["mock-execution"],
      sideEffectsAllowed: false,
      notes: ["preview-only"],
    },
  };
}
