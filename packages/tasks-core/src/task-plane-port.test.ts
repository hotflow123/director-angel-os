import { describe, expect, test } from "vitest";

import { TaskBoard } from "./task-board.js";
import { TaskBoardTaskPlanePort } from "./task-plane-port.js";

describe("TaskBoardTaskPlanePort", () => {
  test("adapts task board operations through async port", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTaskPlanePort(board);

    await port.enqueueDelegation({
      id: "d1",
      workerId: "worker-1",
      instruction: "Implement patch",
    });
    await port.upsertVerification({
      id: "v1",
      verifierId: "qa-1",
      requirement: "Tests must pass",
      status: "pending",
    });
    await port.enqueueProposal({
      id: "p1",
      kind: "trajectory-summary",
      payload: { score: 0.9 },
      sourceSessionId: "s1",
      sourceTurnId: "turn-2",
      provenance: "worker-jobs/replay",
    });

    const state = await port.status();
    expect(state.delegation[0]?.workerId).toBe("worker-1");
    expect(state.verification[0]?.status).toBe("pending");
    expect(state.proposalQueue[0]?.status).toBe("pending");
  });

  test("lists mailbox items and claims queued delegation for the matching worker", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTaskPlanePort(board);

    await port.enqueueDelegation({
      id: "d1",
      workerId: "worker-1",
      instruction: "Implement bounded slice",
      verificationRequest: {
        verificationId: "v_handoff",
        verifierId: "qa-1",
        requirement: "Mailbox slice passes",
      },
    });
    await port.enqueueDelegation({
      id: "d2",
      workerId: "worker-2",
      instruction: "Review task state",
      status: "running",
    });

    const mailbox = await port.listDelegationMailbox({ workerId: "worker-1" });
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]?.id).toBe("d1");
    expect(mailbox[0]?.status).toBe("queued");
    const workerMailbox = await port.readWorkerMailbox({ workerId: "worker-1" });
    expect(workerMailbox).toMatchObject({
      workerId: "worker-1",
      mailboxSize: 1,
      notificationCount: 1,
      coverage: "aligned",
      delegationIds: ["d1"],
      notificationIds: ["notification_delegation_d1"],
      unnotifiedDelegationIds: [],
      orphanNotificationIds: [],
      items: [
        {
          id: "d1",
          workerId: "worker-1",
          instruction: "Implement bounded slice",
          status: "queued",
          verificationRequest: {
            verificationId: "v_handoff",
            verifierId: "qa-1",
            requirement: "Mailbox slice passes",
          },
          notificationId: "notification_delegation_d1",
          notificationStatus: "pending",
          notificationSummary: "Delegation d1 is queued for worker worker-1.",
        },
      ],
    });
    await port.upsertVerification({
      id: "v1",
      taskId: "todo_worker_1",
      verifierId: "qa-1",
      requirement: "Mailbox slice passes",
      status: "pending",
    });
    const verifierMailbox = await port.readVerifierMailbox({ verifierId: "qa-1" });
    expect(verifierMailbox).toMatchObject({
      verifierId: "qa-1",
      mailboxSize: 1,
      notificationCount: 1,
      coverage: "aligned",
      verificationIds: ["v1"],
      notificationIds: ["notification_verification_v1"],
      unnotifiedVerificationIds: [],
      orphanNotificationIds: [],
      items: [
        {
          id: "v1",
          verifierId: "qa-1",
          requirement: "Mailbox slice passes",
          status: "pending",
          taskId: "todo_worker_1",
          notificationId: "notification_verification_v1",
          notificationStatus: "pending",
          notificationSummary: "Verification v1 is pending for verifier qa-1.",
        },
      ],
    });

    const state = await port.claimDelegation({
      id: "d1",
      workerId: "worker-1",
    });
    expect(state.delegation.find((entry) => entry.id === "d1")?.status).toBe("running");
    await expect(
      port.claimDelegation({
        id: "d2",
        workerId: "worker-2",
      }),
    ).rejects.toThrow("is not claimable");
  });

  test("refuses to claim a scheduler-blocked queued delegation", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTaskPlanePort(board);

    await port.enqueueDelegation({
      id: "d_running",
      workerId: "worker-1",
      instruction: "Patch alpha first.",
      contextSnapshot:
        "parentTurnId=turn-scheduler-claim; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    await port.setDelegationStatus({
      id: "d_running",
      status: "running",
    });
    await port.enqueueDelegation({
      id: "d_blocked",
      workerId: "worker-1",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-scheduler-claim; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });

    await expect(
      port.claimDelegation({
        id: "d_blocked",
        workerId: "worker-1",
        respectScheduler: true,
      }),
    ).rejects.toThrow("is blocked by subagent scheduler");

    expect((await port.status()).delegation.find((entry) => entry.id === "d_blocked")?.status).toBe(
      "queued",
    );
  });

  test("reads and applies accepted todo-write proposals", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTaskPlanePort(board);

    await port.enqueueProposal({
      id: "p_apply",
      kind: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_apply", content: "Apply through port", status: "todo" }],
      },
      sourceSessionId: "s1",
      sourceTurnId: "turn-3",
      provenance: "worker-jobs/reconcile",
    });
    await port.transitionProposal({
      proposalId: "p_apply",
      status: "accepted",
    });

    const proposal = await port.getProposal("p_apply");
    expect(proposal?.kind).toBe("tasks.todo_write");
    expect(proposal?.status).toBe("accepted");

    const state = await port.applyProposal("p_apply");
    expect(state.todos.items[0]?.content).toBe("Apply through port");
    expect(state.proposalQueue.find((entry) => entry.id === "p_apply")?.status).toBe("applied");
  });

  test("lists proposals through the async task plane port", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTaskPlanePort(board);

    await port.enqueueProposal({
      id: "p_pending",
      kind: "skills.snapshot_upsert",
      payload: { title: "pending" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-1",
      provenance: "worker-jobs/trajectory-summary",
    });
    await port.enqueueProposal({
      id: "p_rejected",
      kind: "skills.snapshot_upsert",
      payload: { title: "rejected" },
      sourceSessionId: "s1",
      sourceTurnId: "turn-2",
      provenance: "worker-jobs/trajectory-summary",
    });
    await port.transitionProposal({
      proposalId: "p_rejected",
      status: "rejected",
      decisionNote: "Rejected by policy.",
    });

    const pending = await port.listProposals({
      statuses: ["pending"],
    });
    const rejected = await port.listProposals({
      statuses: ["rejected"],
    });

    expect(pending.map((proposal) => proposal.id)).toEqual(["p_pending"]);
    expect(rejected.map((proposal) => proposal.id)).toEqual(["p_rejected"]);
  });
});
