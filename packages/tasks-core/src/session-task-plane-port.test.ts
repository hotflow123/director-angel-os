import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { describe, expect, test } from "vitest";

import {
  SessionStoreTaskPlanePort,
  projectSessionTaskState,
  readCommittedSessionTaskSnapshot,
  readSessionDelegationMailbox,
  readSessionNotificationMailbox,
  readSessionProposalMailbox,
  readSessionVerifierMailbox,
  readSessionWorkerMailbox,
} from "./session-task-plane-port.js";

function createTestSessionStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "hotflow-tasks-core-"));
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

describe("session task plane port", () => {
  test("projects legacy wrapped todo payload from session journal", () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_legacy";
    try {
      setup.store.createSession({ sessionId });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          todos: {
            items: [{ id: "todo_1", content: "wrapped todo payload", status: "doing" }],
            updatedAtMs: 120,
          },
          updatedAtMs: 120,
        },
        createdAtMs: 120,
      });

      const state = projectSessionTaskState(setup.store, sessionId, {
        createIfMissing: false,
      });

      expect(state.todos.items).toHaveLength(1);
      expect(state.todos.items[0]?.content).toBe("wrapped todo payload");
      expect(state.todos.items[0]?.status).toBe("doing");
    } finally {
      setup.cleanup();
    }
  });

  test("persists proposal queue through shared session bridge and exposes committed snapshot", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_snapshot";
    try {
      setup.store.createSession({ sessionId });
      setup.store.appendJournal(sessionId, {
        eventType: "user.input",
        turnId: "turn_1",
        payload: { text: "Summarize the trajectory" },
        createdAtMs: 100,
      });

      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueProposal({
        id: "proposal_1",
        kind: "trajectory-summary",
        payload: { totalJournalEvents: 1 },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_1",
        provenance: "worker-jobs/tests",
      });

      setup.store.createCheckpoint(sessionId, {
        state: {
          tasks: { items: [] },
          lastAssistantOutput: "done",
        },
        createdAtMs: 140,
      });

      const snapshot = readCommittedSessionTaskSnapshot(setup.store, sessionId);

      expect(snapshot.session.sessionId).toBe(sessionId);
      expect(snapshot.latestTurnId).toBe("turn_1");
      expect(snapshot.checkpoint?.uptoSeq).toBe(2);
      expect(snapshot.journal.map((entry) => entry.eventType)).toEqual([
        "user.input",
        "tasks.proposal_enqueued",
      ]);
      expect(snapshot.taskState.proposalQueue).toHaveLength(1);
      expect(snapshot.taskState.proposalQueue[0]).toMatchObject({
        id: "proposal_1",
        sourceSessionId: sessionId,
        sourceTurnId: "turn_1",
        provenance: "worker-jobs/tests",
      });
      expect(snapshot.taskState.proposalOutbox).toHaveLength(1);
    } finally {
      setup.cleanup();
    }
  });

  test("projects queued mailbox items and persists delegation claims through the shared session bridge", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_mailbox";
    try {
      setup.store.createSession({ sessionId });

      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueDelegation({
        id: "d1",
        taskId: "todo_1",
        workerId: "worker-a",
        instruction: "Implement mailbox flow",
        specialization: "plan",
        targetAgent: "plan-agent",
        verificationRequest: {
          verificationId: "v_handoff",
          verifierId: "verifier-a",
          requirement: "Mailbox flow passes",
        },
      });
      await port.upsertVerification({
        id: "v1",
        taskId: "todo_1",
        verifierId: "verifier-a",
        requirement: "Mailbox flow passes",
        status: "pending",
      });

      const beforeClaim = readSessionDelegationMailbox(
        setup.store,
        sessionId,
        { workerId: "worker-a" },
        { createIfMissing: false },
      );
      expect(beforeClaim).toHaveLength(1);
      expect(beforeClaim[0]?.status).toBe("queued");
      expect(
        readSessionNotificationMailbox(
          setup.store,
          sessionId,
          {
            recipientKind: "worker",
            recipientId: "worker-a",
            statuses: ["pending"],
          },
          { createIfMissing: false },
        ).map((entry) => entry.id),
      ).toEqual(["notification_delegation_d1"]);
      expect(
        readSessionWorkerMailbox(
          setup.store,
          sessionId,
          { workerId: "worker-a" },
          { createIfMissing: false },
        ),
      ).toMatchObject({
        workerId: "worker-a",
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
            workerId: "worker-a",
            instruction: "Implement mailbox flow",
            status: "queued",
            taskId: "todo_1",
            specialization: "plan",
            targetAgent: "plan-agent",
            verificationRequest: {
              verificationId: "v_handoff",
              verifierId: "verifier-a",
              requirement: "Mailbox flow passes",
            },
            notificationId: "notification_delegation_d1",
            notificationStatus: "pending",
            notificationSummary: "Delegation d1 is queued for worker worker-a.",
          },
        ],
      });
      expect(
        readSessionVerifierMailbox(
          setup.store,
          sessionId,
          { verifierId: "verifier-a" },
          { createIfMissing: false },
        ),
      ).toMatchObject({
        verifierId: "verifier-a",
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
            verifierId: "verifier-a",
            requirement: "Mailbox flow passes",
            status: "pending",
            taskId: "todo_1",
            notificationId: "notification_verification_v1",
            notificationStatus: "pending",
            notificationSummary: "Verification v1 is pending for verifier verifier-a.",
          },
        ],
      });

      await port.claimDelegation({
        id: "d1",
        workerId: "worker-a",
      });

      const afterState = projectSessionTaskState(setup.store, sessionId, {
        createIfMissing: false,
      });
      expect(afterState.delegation[0]?.status).toBe("running");
      expect(afterState.notifications).toEqual([
        {
          id: "notification_delegation_d1",
          kind: "delegation_assigned",
          recipientKind: "worker",
          recipientId: "worker-a",
          status: "acknowledged",
          summary: "Delegation d1 is queued for worker worker-a.",
          taskId: "todo_1",
          delegationId: "d1",
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
          acknowledgedAtMs: expect.any(Number),
        },
        {
          id: "notification_verification_v1",
          kind: "verification_requested",
          recipientKind: "verifier",
          recipientId: "verifier-a",
          status: "pending",
          summary: "Verification v1 is pending for verifier verifier-a.",
          taskId: "todo_1",
          verificationId: "v1",
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
        },
      ]);
      expect(afterState.lifecycle).toEqual([
        {
          taskId: "todo_1",
          title: "Implement mailbox flow",
          status: "running",
          assignedAgent: "plan-agent",
          latestDelegationId: "d1",
          latestVerificationId: "v1",
        },
      ]);
      expect(
        readSessionDelegationMailbox(
          setup.store,
          sessionId,
          { workerId: "worker-a" },
          { createIfMissing: false },
        ),
      ).toHaveLength(0);
    } finally {
      setup.cleanup();
    }
  });

  test("persists scheduler claim refusal without mutating a blocked delegation", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_scheduler_claim";
    try {
      setup.store.createSession({ sessionId });
      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueDelegation({
        id: "d_running",
        workerId: "worker-a",
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
        workerId: "worker-a",
        instruction: "Patch alpha after the running child.",
        contextSnapshot:
          "parentTurnId=turn-scheduler-claim; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });

      await expect(
        port.claimDelegation({
          id: "d_blocked",
          workerId: "worker-a",
          respectScheduler: true,
        }),
      ).rejects.toThrow("is blocked by subagent scheduler");

      const afterState = projectSessionTaskState(setup.store, sessionId, {
        createIfMissing: false,
      });
      expect(afterState.delegation.find((entry) => entry.id === "d_blocked")?.status).toBe(
        "queued",
      );
      expect(
        (afterState.notifications ?? []).find((entry) => entry.delegationId === "d_blocked")
          ?.status,
      ).toBe("pending");
    } finally {
      setup.cleanup();
    }
  });

  test("persists proposal get/apply through the shared session bridge", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_reconcile";
    try {
      setup.store.createSession({ sessionId });

      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueProposal({
        id: "proposal_apply_1",
        kind: "tasks.todo_write",
        payload: {
          items: [
            { id: "todo_apply_1", content: "Apply accepted proposal", status: "todo" },
            { id: "todo_apply_2", content: "Persist reconcile state", status: "doing" },
          ],
        },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_apply_1",
        provenance: "worker-jobs/reconcile",
      });
      await port.transitionProposal({
        proposalId: "proposal_apply_1",
        status: "accepted",
        decisionNote: "Approved for safe merge.",
      });

      const proposal = await port.getProposal("proposal_apply_1");
      expect(proposal?.status).toBe("accepted");

      const state = await port.applyProposal("proposal_apply_1");
      expect(state.todos.items).toHaveLength(2);
      expect(state.proposalQueue[0]?.status).toBe("applied");

      const snapshot = readCommittedSessionTaskSnapshot(setup.store, sessionId);
      expect(snapshot.taskState.todos.items[0]?.content).toBe("Apply accepted proposal");
      expect(snapshot.taskState.proposalQueue[0]?.status).toBe("applied");
      expect(snapshot.journal.some((entry) => entry.eventType === "tasks.todo_write")).toBe(true);
      expect(
        snapshot.journal.some(
          (entry) =>
            entry.eventType === "tasks.proposal_transitioned" &&
            (entry.payload as { toStatus?: string }).toStatus === "applied",
        ),
      ).toBe(true);
    } finally {
      setup.cleanup();
    }
  });

  test("persists proposal list queries through the shared session bridge", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_tasks_list";
    try {
      setup.store.createSession({ sessionId });

      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });
      await port.enqueueProposal({
        id: "proposal_pending_1",
        kind: "skills.snapshot_upsert",
        payload: { title: "pending" },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_pending",
        provenance: "worker-jobs/trajectory-summary",
      });
      await port.enqueueProposal({
        id: "proposal_accepted_1",
        kind: "skills.snapshot_upsert",
        payload: { title: "accepted" },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_accepted",
        provenance: "worker-jobs/trajectory-summary",
      });
      await port.transitionProposal({
        proposalId: "proposal_accepted_1",
        status: "accepted",
        decisionNote: "Accepted by operator.",
      });

      const pending = await port.listProposals({
        statuses: ["pending"],
      });
      expect(pending.map((proposal) => proposal.id)).toEqual(["proposal_pending_1"]);

      expect(
        readSessionProposalMailbox(
          setup.store,
          sessionId,
          {
            statuses: ["accepted"],
          },
          { createIfMissing: false },
        ).map((proposal) => proposal.id),
      ).toEqual(["proposal_accepted_1"]);
    } finally {
      setup.cleanup();
    }
  });
});
