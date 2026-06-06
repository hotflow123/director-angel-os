import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { describe, expect, test } from "vitest";

import {
  STARTUP_RECONCILIATION_REASON,
  TaskBoard,
  reconcileSessionTaskStartup,
  reconcileTaskBoardStartup,
} from "./index.js";
import {
  SessionStoreTaskPlanePort,
  readCommittedSessionTaskSnapshot,
} from "./session-task-plane-port.js";

function createTestSessionStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "hotflow-tasks-startup-reconciliation-"));
  const store = new SessionStore({
    dbPath: join(tempDir, "sessions.sqlite"),
  });

  return {
    store,
    cleanup() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("startup reconciliation", () => {
  test("requeues orphaned running delegations and records startup_reconciliation in journal", () => {
    let now = 50_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 10;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegation_running",
      taskId: "task_1",
      workerId: "worker-a",
      instruction: "Explore the current repository state.",
    });
    board.setDelegationStatus({
      id: "delegation_running",
      status: "running",
    });
    board.upsertDelegation({
      id: "delegation_queued",
      taskId: "task_2",
      workerId: "worker-b",
      instruction: "Stay queued.",
    });

    const result = reconcileTaskBoardStartup(board);

    expect(result.reconciledDelegationIds).toEqual(["delegation_running"]);
    expect(result.state.delegation.find((entry) => entry.id === "delegation_running")?.status).toBe(
      "queued",
    );
    expect(result.state.delegation.find((entry) => entry.id === "delegation_queued")?.status).toBe(
      "queued",
    );

    const reconciliationEvent = [...board.snapshotJournal()]
      .reverse()
      .find(
        (entry) =>
          entry.eventType === "tasks.delegation_status_set" &&
          entry.payload.record.id === "delegation_running" &&
          entry.payload.reason === STARTUP_RECONCILIATION_REASON,
      );

    expect(reconciliationEvent?.eventType).toBe("tasks.delegation_status_set");
    if (reconciliationEvent?.eventType === "tasks.delegation_status_set") {
      expect(reconciliationEvent.payload.fromStatus).toBe("running");
      expect(reconciliationEvent.payload.toStatus).toBe("queued");
      expect(reconciliationEvent.payload.reason).toBe(STARTUP_RECONCILIATION_REASON);
    }
  });

  test("can downgrade orphaned running delegations to failed with a structured error", () => {
    let now = 60_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 10;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegation_failed",
      taskId: "task_3",
      workerId: "worker-c",
      instruction: "This worker crashed mid-flight.",
    });
    board.setDelegationStatus({
      id: "delegation_failed",
      status: "running",
    });

    const result = reconcileTaskBoardStartup(board, {
      runningDelegationTargetStatus: "failed",
      failureReason: "Worker lock missing after restart.",
    });

    const delegation = result.state.delegation.find((entry) => entry.id === "delegation_failed");
    expect(result.reconciledDelegationIds).toEqual(["delegation_failed"]);
    expect(delegation?.status).toBe("failed");
    expect(delegation?.error).toBe("Worker lock missing after restart.");
    expect(delegation?.completedAtMs).toBeTypeOf("number");
  });

  test("persists startup reconciliation through the session-backed task plane", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_startup_reconciliation";
    try {
      setup.store.createSession({ sessionId });

      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueDelegation({
        id: "delegation_session_running",
        taskId: "task_session_1",
        workerId: "worker-session",
        instruction: "Crash recovery scenario.",
      });
      await port.claimDelegation({
        id: "delegation_session_running",
        workerId: "worker-session",
      });

      const before = readCommittedSessionTaskSnapshot(setup.store, sessionId);
      expect(before.taskState.delegation[0]?.status).toBe("running");

      const result = reconcileSessionTaskStartup(setup.store, sessionId, {
        createIfMissing: false,
      });
      const after = readCommittedSessionTaskSnapshot(setup.store, sessionId);

      expect(result.reconciledDelegationIds).toEqual(["delegation_session_running"]);
      expect(after.taskState.delegation[0]?.status).toBe("queued");

      const reconciliationEvent = [...after.taskJournal]
        .reverse()
        .find(
          (entry) =>
            entry.eventType === "tasks.delegation_status_set" &&
            entry.payload.record.id === "delegation_session_running" &&
            entry.payload.reason === STARTUP_RECONCILIATION_REASON,
        );

      expect(reconciliationEvent?.eventType).toBe("tasks.delegation_status_set");
      if (reconciliationEvent?.eventType === "tasks.delegation_status_set") {
        expect(reconciliationEvent.payload.fromStatus).toBe("running");
        expect(reconciliationEvent.payload.toStatus).toBe("queued");
      }
    } finally {
      setup.cleanup();
    }
  });
});
