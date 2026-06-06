import { describe, expect, test } from "vitest";

import type { TaskItem } from "@hotflow/contracts";
import { TaskBoard } from "./task-board.js";

describe("TaskBoard", () => {
  test("copies input items so caller mutations do not alter internal state", () => {
    const board = new TaskBoard();
    const input: TaskItem[] = [
      { id: "t1", content: "first", status: "todo" },
      { id: "t2", content: "second", status: "doing" },
    ];

    board.writeTodos(input);
    input[0] = { id: "t1", content: "mutated", status: "done" };
    input.push({ id: "t3", content: "new", status: "todo" });

    const snapshot = board.snapshot();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]?.content).toBe("first");
    expect(snapshot.items[0]?.status).toBe("todo");

    const journal = board.snapshotJournal();
    const todoWrite = journal.find((entry) => entry.eventType === "tasks.todo_write");
    expect(todoWrite?.eventType).toBe("tasks.todo_write");
    if (todoWrite?.eventType === "tasks.todo_write") {
      expect(todoWrite.payload.items[0]?.content).toBe("first");
    }
  });

  test("returns snapshots decoupled from board state", () => {
    const board = new TaskBoard({
      items: [{ id: "t1", content: "keep", status: "todo" }],
    });

    const snapshot = board.snapshot();
    (snapshot.items as TaskItem[])[0] = { id: "t1", content: "changed", status: "done" };

    expect(board.answerFirstStep()).toBe("keep");
  });

  test("tracks delegation and verification as structured state", () => {
    let now = 10_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "d1",
      taskId: "t1",
      workerId: "worker-a",
      instruction: "Read docs and summarize.",
    });
    board.setDelegationStatus({
      id: "d1",
      status: "completed",
    });
    board.upsertVerification({
      id: "v1",
      taskId: "t1",
      verifierId: "verifier-a",
      requirement: "Summary cites source files.",
      status: "partial",
      verifiedBy: "verify-agent",
      verdict: "partial",
      verdictSummary: "Build passed, but replay still needs one more manual pass.",
      checks: [
        {
          id: "build",
          status: "pass",
          summary: "Build completed successfully.",
        },
        {
          id: "replay",
          status: "partial",
          summary: "Replay still needs one more manual pass.",
        },
      ],
    });

    const snapshot = board.snapshotOperations();
    expect(snapshot.delegation).toHaveLength(1);
    expect(snapshot.delegation[0]?.status).toBe("completed");
    expect(snapshot.verification).toHaveLength(1);
    expect(snapshot.verification[0]?.status).toBe("partial");
    expect(snapshot.verification[0]?.verifiedBy).toBe("verify-agent");
    expect(snapshot.verification[0]?.verdict).toBe("partial");
    expect(snapshot.verification[0]?.verdictSummary).toBe(
      "Build passed, but replay still needs one more manual pass.",
    );
    expect(snapshot.verification[0]?.checks).toEqual([
      {
        id: "build",
        status: "pass",
        summary: "Build completed successfully.",
      },
      {
        id: "replay",
        status: "partial",
        summary: "Replay still needs one more manual pass.",
      },
    ]);
    expect(snapshot.lifecycle).toEqual([
      {
        taskId: "t1",
        title: "Read docs and summarize.",
        status: "blocked",
        assignedAgent: "worker-a",
        verificationVerdict: "partial",
        latestDelegationId: "d1",
        latestVerificationId: "v1",
      },
    ]);
  });

  test("retains delegation provenance, context snapshot, and completion summary", () => {
    let now = 15_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "d_meta",
      taskId: "t_meta",
      workerId: "worker-meta",
      instruction: "Implement the bounded metadata slice.",
      fromAgent: "plan-agent",
      contextSnapshot: "repo=director-angel; focus=tasks-core; risk=low",
      specialization: "plan",
      targetAgent: "plan-agent",
      verificationRequest: {
        verificationId: "v_meta",
        verifierId: "verify-meta",
        requirement: "Bounded metadata slice passes verification.",
      },
    });
    board.setDelegationStatus({
      id: "d_meta",
      status: "completed",
      resultSummary: "Implemented the bounded metadata slice and handed off verification.",
    });

    const snapshot = board.snapshotOperations();
    expect(snapshot.delegation[0]).toMatchObject({
      id: "d_meta",
      fromAgent: "plan-agent",
      contextSnapshot: "repo=director-angel; focus=tasks-core; risk=low",
      specialization: "plan",
      targetAgent: "plan-agent",
      verificationRequest: {
        verificationId: "v_meta",
        verifierId: "verify-meta",
        requirement: "Bounded metadata slice passes verification.",
      },
      resultSummary: "Implemented the bounded metadata slice and handed off verification.",
      status: "completed",
    });
  });

  test("emits pending notifications and acknowledges them when work is consumed", () => {
    let now = 18_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "d_notify",
      taskId: "todo_notify",
      workerId: "worker-a",
      instruction: "Handle queued delegation",
    });

    let snapshot = board.snapshotOperations();
    expect(snapshot.notifications).toEqual([
      {
        id: "notification_delegation_d_notify",
        kind: "delegation_assigned",
        recipientKind: "worker",
        recipientId: "worker-a",
        status: "pending",
        summary: "Delegation d_notify is queued for worker worker-a.",
        taskId: "todo_notify",
        delegationId: "d_notify",
        createdAtMs: 18001,
        updatedAtMs: 18001,
      },
    ]);

    board.setDelegationStatus({
      id: "d_notify",
      status: "running",
    });
    board.upsertVerification({
      id: "v_notify",
      taskId: "todo_notify",
      verifierId: "verifier-a",
      requirement: "Verify queued output",
      status: "pending",
    });

    snapshot = board.snapshotOperations();
    expect(snapshot.notifications).toEqual([
      {
        id: "notification_delegation_d_notify",
        kind: "delegation_assigned",
        recipientKind: "worker",
        recipientId: "worker-a",
        status: "acknowledged",
        summary: "Delegation d_notify is queued for worker worker-a.",
        taskId: "todo_notify",
        delegationId: "d_notify",
        createdAtMs: 18001,
        updatedAtMs: 18002,
        acknowledgedAtMs: 18002,
      },
      {
        id: "notification_verification_v_notify",
        kind: "verification_requested",
        recipientKind: "verifier",
        recipientId: "verifier-a",
        status: "pending",
        summary: "Verification v_notify is pending for verifier verifier-a.",
        taskId: "todo_notify",
        verificationId: "v_notify",
        createdAtMs: 18003,
        updatedAtMs: 18003,
      },
    ]);

    board.upsertVerification({
      id: "v_notify",
      taskId: "todo_notify",
      verifierId: "verifier-a",
      requirement: "Verify queued output",
      status: "passed",
      verdict: "pass",
    });

    snapshot = board.snapshotOperations();
    expect(snapshot.notifications?.[1]).toEqual({
      id: "notification_verification_v_notify",
      kind: "verification_requested",
      recipientKind: "verifier",
      recipientId: "verifier-a",
      status: "acknowledged",
      summary: "Verification v_notify is pending for verifier verifier-a.",
      taskId: "todo_notify",
      verificationId: "v_notify",
      createdAtMs: 18003,
      updatedAtMs: 18004,
      acknowledgedAtMs: 18004,
    });

    expect(
      board
        .snapshotJournal()
        .filter(
          (entry) =>
            entry.eventType === "tasks.notification_emitted" ||
            entry.eventType === "tasks.notification_status_set",
        )
        .map((entry) => entry.eventType),
    ).toEqual([
      "tasks.notification_emitted",
      "tasks.notification_status_set",
      "tasks.notification_emitted",
      "tasks.notification_status_set",
    ]);
  });

  test("manages proposal queue lifecycle and outbox", () => {
    let now = 20_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 5;
        return now;
      },
    });

    board.enqueueProposal({
      id: "p1",
      kind: "skill-proposal",
      payload: { title: "Use stronger parser" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-1",
      provenance: "worker-jobs/trajectory-analysis",
    });
    board.transitionProposal({
      proposalId: "p1",
      status: "accepted",
      decisionNote: "Ready for apply step.",
    });
    board.transitionProposal({
      proposalId: "p1",
      status: "applied",
    });

    const snapshot = board.snapshotOperations();
    expect(snapshot.proposalQueue[0]?.status).toBe("applied");
    expect(snapshot.proposalQueue[0]?.sourceSessionId).toBe("s1");
    expect(snapshot.proposalQueue[0]?.sourceTurnId).toBe("turn-1");
    expect(snapshot.proposalQueue[0]?.provenance).toContain("worker-jobs");
    expect(snapshot.proposalOutbox).toHaveLength(3);

    const drained = board.drainProposalOutbox(2);
    expect(drained).toHaveLength(2);
    expect(board.snapshotOperations().proposalOutbox).toHaveLength(1);
  });

  test("applies accepted tasks.todo_write proposals through the safe merge boundary", () => {
    let now = 40_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 5;
        return now;
      },
    });

    board.enqueueProposal({
      id: "p_apply",
      kind: "tasks.todo_write",
      payload: {
        items: [
          { id: "todo_1", content: "Merged from proposal", status: "todo" },
          { id: "todo_2", content: "Keep bounded scope", status: "doing" },
        ],
      },
      sourceSessionId: "s_apply",
      sourceTurnId: "turn_apply",
      provenance: "worker-jobs/reconcile",
    });
    board.transitionProposal({
      proposalId: "p_apply",
      status: "accepted",
      decisionNote: "Approved for bounded merge.",
    });

    const beforeApply = board.getProposal("p_apply");
    expect(beforeApply?.status).toBe("accepted");

    const afterApply = board.applyProposal("p_apply");
    expect(afterApply.todos.items).toHaveLength(2);
    expect(afterApply.todos.items[0]?.content).toBe("Merged from proposal");
    expect(afterApply.proposalQueue.find((proposal) => proposal.id === "p_apply")?.status).toBe(
      "applied",
    );
    expect(afterApply.proposalOutbox).toHaveLength(3);

    const journal = board.snapshotJournal();
    expect(journal.some((entry) => entry.eventType === "tasks.todo_write")).toBe(true);
    expect(
      journal.some(
        (entry) =>
          entry.eventType === "tasks.proposal_transitioned" &&
          entry.payload.proposal.id === "p_apply" &&
          entry.payload.toStatus === "applied",
      ),
    ).toBe(true);
  });

  test("rejects invalid proposal transitions", () => {
    const board = new TaskBoard();
    board.enqueueProposal({
      id: "p1",
      kind: "memory-candidate",
      payload: { memoryId: "m1" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-1",
      provenance: "worker-jobs/memory-sync",
    });

    expect(() =>
      board.transitionProposal({
        proposalId: "p1",
        status: "applied",
      }),
    ).toThrow("Invalid proposal transition");
  });

  test("rejects apply when proposal is not accepted or is not a safe kind", () => {
    const board = new TaskBoard();
    board.enqueueProposal({
      id: "p_pending",
      kind: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_pending", content: "pending", status: "todo" }],
      },
      sourceSessionId: "s1",
      sourceTurnId: "turn-1",
      provenance: "worker-jobs/reconcile",
    });
    board.enqueueProposal({
      id: "p_unsupported",
      kind: "skill-proposal",
      payload: { title: "unsupported" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-2",
      provenance: "worker-jobs/reconcile",
    });
    board.transitionProposal({
      proposalId: "p_unsupported",
      status: "accepted",
    });

    expect(() => board.applyProposal("p_pending")).toThrow(
      "Proposal must be accepted before apply",
    );
    expect(() => board.applyProposal("p_unsupported")).toThrow(
      "Unsupported proposal kind for safe apply",
    );
  });

  test("derives replay-stable outbox ids without in-memory sequence", () => {
    function createBoardWithClock(): TaskBoard {
      const ticks = [30_000, 30_010, 30_020];
      return new TaskBoard(undefined, {
        now: () => {
          const next = ticks.shift();
          if (next === undefined) {
            throw new Error("clock exhausted");
          }
          return next;
        },
      });
    }

    const boardA = createBoardWithClock();
    const boardB = createBoardWithClock();

    for (const board of [boardA, boardB]) {
      board.enqueueProposal({
        id: "p1",
        kind: "skill-proposal",
        payload: { title: "Promote parser skill" },
        sourceSessionId: "s1",
        sourceTurnId: "turn-1",
        provenance: "worker-jobs/trajectory-analysis",
      });
      board.transitionProposal({
        proposalId: "p1",
        status: "accepted",
      });
      board.drainProposalOutbox(1);
    }

    const journalA = boardA.drainJournal();
    const journalB = boardB.drainJournal();
    const outboxIdsA = journalA.flatMap((entry) => {
      if (
        entry.eventType !== "tasks.proposal_enqueued" &&
        entry.eventType !== "tasks.proposal_transitioned"
      ) {
        return [];
      }
      return [entry.payload.outboxEntry.id];
    });
    const outboxIdsB = journalB.flatMap((entry) => {
      if (
        entry.eventType !== "tasks.proposal_enqueued" &&
        entry.eventType !== "tasks.proposal_transitioned"
      ) {
        return [];
      }
      return [entry.payload.outboxEntry.id];
    });

    expect(outboxIdsA).toEqual(outboxIdsB);
    expect(outboxIdsA[0]).toContain("proposal_enqueued");
    expect(outboxIdsA[1]).toContain("proposal_status_changed");
  });
});
