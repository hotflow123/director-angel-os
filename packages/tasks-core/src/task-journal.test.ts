import { describe, expect, test } from "vitest";

import { TaskBoard } from "./task-board.js";
import {
  applyTaskJournalEntry,
  createTaskJournalEntry,
  isTaskJournalEventType,
  projectTaskOperationsFromJournal,
  toTaskJournalEntry,
} from "./task-journal.js";
import { createInitialTaskOperationsState } from "./task-operations.js";

describe("task journal projection", () => {
  test("rebuilds task operations state from replayed task board journal events", () => {
    let now = 1_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 10;
        return now;
      },
    });

    board.writeTodos([
      { id: "t1", content: "Define control-plane slice", status: "todo" },
      { id: "t2", content: "Implement projection", status: "doing" },
    ]);
    board.upsertDelegation({
      id: "d1",
      taskId: "t1",
      workerId: "worker-a",
      instruction: "Draft implementation diff",
    });
    board.setDelegationStatus({
      id: "d1",
      status: "completed",
    });
    board.upsertVerification({
      id: "v1",
      taskId: "t1",
      verifierId: "verifier-a",
      requirement: "Cover replay tests",
      status: "partial",
      verifiedBy: "verify-agent",
      verdict: "partial",
      verdictSummary: "Looks deterministic.",
      checks: [
        {
          id: "build",
          status: "pass",
          summary: "Build completed successfully.",
        },
        {
          id: "replay",
          status: "partial",
          summary: "Replay still needs manual inspection.",
        },
      ],
    });
    board.enqueueProposal({
      id: "p1",
      kind: "skill-proposal",
      payload: { title: "Add projection helper" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-1",
      provenance: "worker-jobs/trajectory-analysis",
    });
    board.transitionProposal({
      proposalId: "p1",
      status: "accepted",
      decisionNote: "Ready to apply",
    });
    board.drainProposalOutbox(1);

    const firstBatch = board.drainJournal(3);
    const secondBatch = board.drainJournal();
    const replayed = projectTaskOperationsFromJournal([...firstBatch, ...secondBatch]);

    expect(replayed).toEqual(board.snapshotOperations());
    expect(replayed.verification[0]).toMatchObject({
      id: "v1",
      status: "partial",
      verifiedBy: "verify-agent",
      verdict: "partial",
      checks: [
        {
          id: "build",
          status: "pass",
          summary: "Build completed successfully.",
        },
        {
          id: "replay",
          status: "partial",
          summary: "Replay still needs manual inspection.",
        },
      ],
    });
    expect(replayed.notifications).toEqual([
      {
        id: "notification_delegation_d1",
        kind: "delegation_assigned",
        recipientKind: "worker",
        recipientId: "worker-a",
        status: "acknowledged",
        summary: "Delegation d1 is queued for worker worker-a.",
        taskId: "t1",
        delegationId: "d1",
        createdAtMs: 1020,
        updatedAtMs: 1030,
        acknowledgedAtMs: 1030,
      },
    ]);
    expect(replayed.lifecycle).toEqual([
      {
        taskId: "t1",
        title: "Define control-plane slice",
        status: "blocked",
        todoStatus: "todo",
        assignedAgent: "worker-a",
        verificationVerdict: "partial",
        latestDelegationId: "d1",
        latestVerificationId: "v1",
      },
      {
        taskId: "t2",
        title: "Implement projection",
        status: "running",
        todoStatus: "doing",
      },
    ]);
    expect(board.drainJournal()).toEqual([]);
  });

  test("applies explicit outbox drain event by id and keeps queue deterministic", () => {
    const initial = createInitialTaskOperationsState();
    const appended = applyTaskJournalEntry(
      initial,
      createTaskJournalEntry({
        eventType: "tasks.proposal_enqueued",
        createdAtMs: 100,
        payload: {
          proposal: {
            id: "p1",
            kind: "trajectory-summary",
            payload: { score: 0.9 },
            status: "pending",
            schemaVersion: "0.1.0",
            sourceSessionId: "s1",
            sourceTurnId: "turn-1",
            provenance: "worker-jobs/replay",
            createdAtMs: 100,
            updatedAtMs: 100,
          },
          outboxEntry: {
            id: "outbox_100_1",
            eventType: "proposal.enqueued",
            proposalId: "p1",
            status: "pending",
            schemaVersion: "0.1.0",
            createdAtMs: 100,
          },
          updatedAtMs: 100,
        },
      }),
    );

    const drained = applyTaskJournalEntry(
      appended,
      createTaskJournalEntry({
        eventType: "tasks.proposal_outbox_drained",
        createdAtMs: 110,
        payload: {
          drainedIds: ["outbox_100_1"],
          drainedAtMs: 110,
          updatedAtMs: 110,
        },
      }),
    );

    expect(drained.proposalQueue[0]?.id).toBe("p1");
    expect(drained.proposalOutbox).toHaveLength(0);
  });

  test("validates task journal event vocabulary", () => {
    expect(isTaskJournalEventType("tasks.delegation_upserted")).toBe(true);
    expect(isTaskJournalEventType("tasks.notification_emitted")).toBe(true);
    expect(isTaskJournalEventType("tasks.unknown")).toBe(false);
  });

  test("supports flat todo_write payload in journal decoding", () => {
    const parsed = toTaskJournalEntry({
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "t1", content: "flat payload", status: "todo" }],
        updatedAtMs: 2_000,
      },
      createdAtMs: 2_010,
      schemaVersion: "0.1.0",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe("tasks.todo_write");
    if (parsed?.eventType === "tasks.todo_write") {
      expect(parsed.payload.items[0]?.content).toBe("flat payload");
      expect(parsed.payload.updatedAtMs).toBe(2_000);
    }
  });

  test("keeps legacy wrapped todo_write payload readable", () => {
    const parsed = toTaskJournalEntry({
      eventType: "tasks.todo_write",
      payload: {
        todos: {
          items: [{ id: "legacy_1", content: "legacy payload", status: "todo" }],
        },
        updatedAtMs: 3_000,
      },
      createdAtMs: 3_010,
      schemaVersion: "0.1.0",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe("tasks.todo_write");
    if (parsed?.eventType !== "tasks.todo_write") {
      return;
    }

    expect(parsed.payload.items[0]?.id).toBe("legacy_1");
    expect(parsed.payload.updatedAtMs).toBe(3_000);
  });

  test("normalizes legacy drained outbox payload into drainedIds", () => {
    const parsed = toTaskJournalEntry({
      eventType: "tasks.proposal_outbox_drained",
      payload: {
        drained: [
          {
            id: "outbox_legacy_1",
            eventType: "proposal.enqueued",
            proposalId: "p1",
            status: "pending",
            schemaVersion: "0.1.0",
            createdAtMs: 10,
          },
        ],
        updatedAtMs: 20,
      },
      createdAtMs: 25,
      schemaVersion: "sessions/v1",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe("tasks.proposal_outbox_drained");
    if (parsed?.eventType !== "tasks.proposal_outbox_drained") {
      return;
    }

    expect(parsed.payload.drainedIds).toEqual(["outbox_legacy_1"]);
    expect(parsed.payload.updatedAtMs).toBe(20);
  });
});
