import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { describe, expect, test } from "vitest";

import {
  listDelegationMailbox,
  listNotificationMailbox,
  listProposalMailbox,
  listVerificationMailbox,
  readVerifierMailbox,
  readWorkerMailbox,
} from "./mailbox.js";
import {
  SessionStoreTaskPlanePort,
  readSessionDelegationMailbox,
  readSessionNotificationMailbox,
  readSessionProposalMailbox,
  readSessionTaskJournal,
  readSessionVerificationMailbox,
  readSessionVerifierMailbox,
  readSessionWorkerMailbox,
} from "./session-task-plane-port.js";
import { TaskBoard } from "./task-board.js";

function createTestSessionStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "hotflow-mailbox-"));
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

describe("task mailbox selectors", () => {
  test("filters delegation and verification views from task state", () => {
    let now = 1_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 10;
        return now;
      },
    });

    board.upsertDelegation({
      id: "d2",
      workerId: "worker-b",
      instruction: "review docs",
    });
    board.upsertDelegation({
      id: "d1",
      taskId: "todo_1",
      workerId: "worker-a",
      instruction: "implement task",
      specialization: "plan",
      targetAgent: "plan-agent",
      verificationRequest: {
        verificationId: "v_handoff",
        verifierId: "verifier-a",
        requirement: "check implementation",
      },
    });
    board.setDelegationStatus({
      id: "d2",
      status: "running",
    });
    board.upsertVerification({
      id: "v2",
      verifierId: "verifier-a",
      requirement: "check docs review",
      status: "passed",
      verifiedBy: "verify-agent",
      verdict: "pass",
      checks: [
        {
          id: "docs",
          status: "pass",
          summary: "Docs review passed.",
        },
      ],
    });
    board.upsertVerification({
      id: "v1",
      taskId: "todo_1",
      verifierId: "verifier-a",
      requirement: "check implementation",
      status: "pending",
    });

    const snapshot = board.snapshotOperations();
    expect(
      listDelegationMailbox(snapshot, {
        workerId: "worker-a",
        statuses: ["queued"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["d1"]);
    expect(
      listVerificationMailbox(snapshot, {
        verifierId: "verifier-a",
        statuses: ["pending"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["v1"]);
    expect(
      listVerificationMailbox(snapshot, {
        verifierId: "verifier-a",
        statuses: ["passed"],
      })[0],
    ).toMatchObject({
      id: "v2",
      verifiedBy: "verify-agent",
      verdict: "pass",
      checks: [
        {
          id: "docs",
          status: "pass",
          summary: "Docs review passed.",
        },
      ],
    });
    expect(
      listNotificationMailbox(snapshot, {
        recipientKind: "worker",
        recipientId: "worker-a",
        statuses: ["pending"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["notification_delegation_d1"]);
    expect(
      listNotificationMailbox(snapshot, {
        recipientKind: "verifier",
        recipientId: "verifier-a",
        statuses: ["pending"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["notification_verification_v1"]);
    expect(readWorkerMailbox(snapshot, { workerId: "worker-a" })).toMatchObject({
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
          instruction: "implement task",
          status: "queued",
          taskId: "todo_1",
          specialization: "plan",
          targetAgent: "plan-agent",
          verificationRequest: {
            verificationId: "v_handoff",
            verifierId: "verifier-a",
            requirement: "check implementation",
          },
          notificationId: "notification_delegation_d1",
          notificationStatus: "pending",
          notificationSummary: "Delegation d1 is queued for worker worker-a.",
        },
      ],
    });
    expect(readVerifierMailbox(snapshot, { verifierId: "verifier-a" })).toMatchObject({
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
          requirement: "check implementation",
          status: "pending",
          taskId: "todo_1",
          notificationId: "notification_verification_v1",
          notificationStatus: "pending",
          notificationSummary: "Verification v1 is pending for verifier verifier-a.",
        },
      ],
    });
  });

  test("filters proposal mailbox views from task state", () => {
    let now = 2_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 10;
        return now;
      },
    });

    board.enqueueProposal({
      id: "p2",
      kind: "skills.snapshot_upsert",
      payload: { title: "second" },
      sourceSessionId: "s1",
      sourceTurnId: "turn_2",
      provenance: "worker-jobs/trajectory-summary",
    });
    board.enqueueProposal({
      id: "p1",
      kind: "skills.snapshot_upsert",
      payload: { title: "first" },
      sourceSessionId: "s1",
      sourceTurnId: "turn_1",
      provenance: "worker-jobs/trajectory-summary",
    });
    board.transitionProposal({
      proposalId: "p2",
      status: "accepted",
      decisionNote: "Looks good.",
    });

    const snapshot = board.snapshotOperations();
    expect(
      listProposalMailbox(snapshot, {
        statuses: ["pending"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["p1"]);
    expect(
      listProposalMailbox(snapshot, {
        statuses: ["accepted"],
      }).map((entry: { readonly id: string }) => entry.id),
    ).toEqual(["p2"]);
  });

  test("reads mailbox views from persisted session task journal", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_mailbox_reads";

    try {
      setup.store.createSession({ sessionId });
      const port = new SessionStoreTaskPlanePort(setup.store, sessionId, {
        createIfMissing: false,
      });

      await port.enqueueDelegation({
        id: "d1",
        taskId: "todo_1",
        workerId: "worker-a",
        instruction: "implement bounded task flow",
        specialization: "plan",
        targetAgent: "plan-agent",
      });
      await port.enqueueDelegation({
        id: "d2",
        workerId: "worker-b",
        instruction: "review benchmark fixture",
      });
      await port.upsertVerification({
        id: "v1",
        taskId: "todo_1",
        verifierId: "verifier-a",
        requirement: "bounded flow passes",
        status: "pending",
      });
      await port.upsertVerification({
        id: "v2",
        verifierId: "verifier-b",
        requirement: "review benchmark fixture",
        status: "failed",
        verifiedBy: "verify-agent",
        verdict: "fail",
        verdictSummary: "fixture drifted",
        checks: [
          {
            id: "fixture",
            status: "fail",
            summary: "Fixture drifted.",
            detail: "Expected snapshot and replay output diverged.",
          },
        ],
      });
      await port.enqueueProposal({
        id: "p1",
        kind: "skills.snapshot_upsert",
        payload: { title: "pending proposal" },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_1",
        provenance: "worker-jobs/trajectory-summary",
      });
      await port.enqueueProposal({
        id: "p2",
        kind: "skills.snapshot_upsert",
        payload: { title: "accepted proposal" },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_2",
        provenance: "worker-jobs/trajectory-summary",
      });
      await port.transitionProposal({
        proposalId: "p2",
        status: "accepted",
        decisionNote: "Accepted for operator review.",
      });

      expect(
        readSessionDelegationMailbox(
          setup.store,
          sessionId,
          {
            workerId: "worker-a",
            statuses: ["queued"],
          },
          { createIfMissing: false },
        ).map((entry: { readonly id: string }) => entry.id),
      ).toEqual(["d1"]);

      expect(
        readSessionVerificationMailbox(
          setup.store,
          sessionId,
          {
            verifierId: "verifier-a",
            statuses: ["pending"],
          },
          { createIfMissing: false },
        ).map((entry: { readonly id: string }) => entry.id),
      ).toEqual(["v1"]);
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
        ).map((entry: { readonly id: string }) => entry.id),
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
            instruction: "implement bounded task flow",
            status: "queued",
            taskId: "todo_1",
            specialization: "plan",
            targetAgent: "plan-agent",
            notificationId: "notification_delegation_d1",
            notificationStatus: "pending",
            notificationSummary: "Delegation d1 is queued for worker worker-a.",
          },
        ],
      });
      expect(
        readSessionNotificationMailbox(
          setup.store,
          sessionId,
          {
            recipientKind: "verifier",
            recipientId: "verifier-a",
            statuses: ["pending"],
          },
          { createIfMissing: false },
        ).map((entry: { readonly id: string }) => entry.id),
      ).toEqual(["notification_verification_v1"]);
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
            requirement: "bounded flow passes",
            status: "pending",
            taskId: "todo_1",
            notificationId: "notification_verification_v1",
            notificationStatus: "pending",
            notificationSummary: "Verification v1 is pending for verifier verifier-a.",
          },
        ],
      });

      expect(
        readSessionProposalMailbox(
          setup.store,
          sessionId,
          {
            statuses: ["pending"],
          },
          { createIfMissing: false },
        ).map((entry: { readonly id: string }) => entry.id),
      ).toEqual(["p1"]);
      expect(
        readSessionProposalMailbox(
          setup.store,
          sessionId,
          {
            statuses: ["accepted"],
          },
          { createIfMissing: false },
        ).map((entry: { readonly id: string }) => entry.id),
      ).toEqual(["p2"]);

      const journal = readSessionTaskJournal(setup.store, sessionId, { createIfMissing: false });
      expect(journal).toHaveLength(10);
      expect(
        journal
          .filter((entry) => entry.eventType === "tasks.notification_emitted")
          .map((entry) => entry.payload.record.id),
      ).toEqual([
        "notification_delegation_d1",
        "notification_delegation_d2",
        "notification_verification_v1",
      ]);
      expect(
        readSessionVerificationMailbox(
          setup.store,
          sessionId,
          {
            verifierId: "verifier-b",
            statuses: ["failed"],
          },
          { createIfMissing: false },
        )[0],
      ).toMatchObject({
        id: "v2",
        verifiedBy: "verify-agent",
        verdict: "fail",
        checks: [
          {
            id: "fixture",
            status: "fail",
            summary: "Fixture drifted.",
            detail: "Expected snapshot and replay output diverged.",
          },
        ],
      });
    } finally {
      setup.cleanup();
    }
  });
});
