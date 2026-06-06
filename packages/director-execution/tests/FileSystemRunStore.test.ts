import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type {
  ExecutionEvent,
  ExecutionRun,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import { FileSystemRunStore } from "../src/store.ts";

describe("FileSystemRunStore", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "director-execution-store-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("persists runs and events to disk", async () => {
    const store = new FileSystemRunStore({ rootPath: workspaceRoot });
    const run: ExecutionRun = {
      schemaVersion: "director.execution.run.v1",
      runId: "run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      goal: "Preview-safe run",
      previewSummary: "Preview only",
      sideEffectsAllowed: false,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      status: "created",
      assignments: [],
      events: [],
    };

    await store.saveRun(run);
    const loaded = await store.loadRun("run-1");
    expect(loaded).toEqual(run);

    const event: ExecutionEvent = {
      eventId: "event-1",
      runId: run.runId,
      type: "run-created",
      occurredAt: "2026-04-12T00:01:00.000Z",
      message: "Execution run created.",
      payload: { assignmentId: "assignment-1" },
    };

    await store.appendEvent(event);
    const events = await store.listEvents(run.runId);
    expect(events).toContainEqual(event);

    const reloaded = await store.loadRun(run.runId);
    expect(reloaded?.events).toContainEqual(event);
    expect(reloaded?.updatedAt).toBe(event.occurredAt);
  });

  test("persists reports to disk", async () => {
    const store = new FileSystemRunStore({ rootPath: workspaceRoot });
    const report: ExecutionRunReport = {
      schemaVersion: "director.execution.run.v1",
      reportId: "report-1",
      runId: "run-1",
      run: {
        schemaVersion: "director.execution.run.v1",
        runId: "run-1",
        snapshotId: "snapshot-1",
        runtimeId: "runtime-1",
        blueprintId: "blueprint-1",
        handoffId: "handoff-1",
        actionGraphId: "graph-1",
        goal: "Preview-safe run",
        previewSummary: "Preview only",
        sideEffectsAllowed: false,
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        status: "completed",
        assignments: [],
        events: [],
      },
      recordedAt: "2026-04-12T00:02:00.000Z",
      summary: ["run status=completed"],
      flags: ["preview-only"],
      events: [],
    };

    await store.saveReport(report);
    const loaded = await store.loadReport("run-1");
    expect(loaded).toEqual(report);
  });

  test("loads legacy runs with missing assignment context arrays", async () => {
    const store = new FileSystemRunStore({ rootPath: workspaceRoot });
    const runPath = join(workspaceRoot, "runs", "legacy-run", "run.json");
    await mkdir(dirname(runPath), { recursive: true });
    await writeFile(
      runPath,
      `${JSON.stringify(
        {
          schemaVersion: "director.execution.run.v1",
          runId: "legacy-run",
          snapshotId: "snapshot-legacy",
          runtimeId: "runtime-legacy",
          blueprintId: "blueprint-legacy",
          handoffId: "handoff-legacy",
          actionGraphId: "graph-legacy",
          goal: "Legacy review run",
          previewSummary: "Created before assignment context arrays existed.",
          sideEffectsAllowed: false,
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
          status: "created",
          assignments: [
            {
              runId: "legacy-run",
              assignmentId: "legacy-assignment",
              role: "asset-router",
              objective: "Submit after operator review.",
              deliverable: "Production request",
              actionClass: "generate",
              approvalMode: "operator_approve",
              dependsOn: [],
              status: "pending",
              createdAt: "2026-04-12T00:00:00.000Z",
            },
          ],
          events: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const loaded = await store.loadRun("legacy-run");

    expect(loaded?.assignments[0]).toMatchObject({
      inputs: [],
      outputs: [],
      acceptanceCriteria: [],
      constraints: [],
    });
  });
});
