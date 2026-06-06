import type { SessionStore } from "@hotflow/sessions";
import { readSessionWorkerMailbox } from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface ListDelegationMailboxInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly workerId?: string;
  readonly sessionStore?: SessionStore;
}

export interface ListDelegationMailboxReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly workerId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: string;
  readonly delegationIds: readonly string[];
  readonly notificationIds: readonly string[];
  readonly unnotifiedDelegationIds: readonly string[];
  readonly orphanNotificationIds: readonly string[];
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly workerId: string;
    readonly instruction: string;
    readonly status: string;
    readonly taskId?: string;
    readonly specialization?: "explore" | "plan" | "verify" | "general";
    readonly targetAgent?: string;
    readonly verificationRequest?: {
      readonly verifierId: string;
      readonly requirement: string;
      readonly verificationId?: string;
    };
    readonly notificationId?: string;
    readonly notificationStatus?: string;
    readonly notificationSummary?: string;
  }>;
  readonly notifications: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly recipientId: string;
    readonly summary: string;
    readonly taskId?: string;
    readonly delegationId?: string;
  }>;
}

export async function listDelegationMailboxJob(
  input: ListDelegationMailboxInput,
): Promise<ListDelegationMailboxReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);

  try {
    const mailbox = readSessionWorkerMailbox(
      sessionStore,
      input.sessionId,
      { ...(input.workerId === undefined ? {} : { workerId: input.workerId }) },
      { createIfMissing: false },
    );

    return {
      status: "ok",
      sessionId: input.sessionId,
      ...(input.workerId === undefined ? {} : { workerId: input.workerId }),
      mailboxSize: mailbox.mailboxSize,
      notificationCount: mailbox.notificationCount,
      coverage: mailbox.coverage,
      delegationIds: mailbox.delegationIds,
      notificationIds: mailbox.notificationIds,
      unnotifiedDelegationIds: mailbox.unnotifiedDelegationIds,
      orphanNotificationIds: mailbox.orphanNotificationIds,
      items: mailbox.items.map((record) => ({
        id: record.id,
        workerId: record.workerId,
        instruction: record.instruction,
        status: record.status,
        ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
        ...(record.specialization === undefined ? {} : { specialization: record.specialization }),
        ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
        ...(record.verificationRequest === undefined
          ? {}
          : {
              verificationRequest: {
                verifierId: record.verificationRequest.verifierId,
                requirement: record.verificationRequest.requirement,
                ...(record.verificationRequest.verificationId === undefined
                  ? {}
                  : { verificationId: record.verificationRequest.verificationId }),
              },
            }),
        ...(record.notificationId === undefined ? {} : { notificationId: record.notificationId }),
        ...(record.notificationStatus === undefined
          ? {}
          : { notificationStatus: record.notificationStatus }),
        ...(record.notificationSummary === undefined
          ? {}
          : { notificationSummary: record.notificationSummary }),
      })),
      notifications: mailbox.notifications.map((record) => ({
        id: record.id,
        kind: record.kind,
        status: record.status,
        recipientId: record.recipientId,
        summary: record.summary,
        ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
        ...(record.delegationId === undefined ? {} : { delegationId: record.delegationId }),
      })),
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}
