import type { SessionStore } from "@hotflow/sessions";
import { readSessionVerifierMailbox } from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface ListVerifierMailboxInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly verifierId?: string;
  readonly sessionStore?: SessionStore;
}

export interface ListVerifierMailboxReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly verifierId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: string;
  readonly verificationIds: readonly string[];
  readonly notificationIds: readonly string[];
  readonly unnotifiedVerificationIds: readonly string[];
  readonly orphanNotificationIds: readonly string[];
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly verifierId: string;
    readonly requirement: string;
    readonly status: string;
    readonly taskId?: string;
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
    readonly verificationId?: string;
  }>;
}

export async function listVerifierMailboxJob(
  input: ListVerifierMailboxInput,
): Promise<ListVerifierMailboxReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);

  try {
    const mailbox = readSessionVerifierMailbox(
      sessionStore,
      input.sessionId,
      { ...(input.verifierId === undefined ? {} : { verifierId: input.verifierId }) },
      { createIfMissing: false },
    );

    return {
      status: "ok",
      sessionId: input.sessionId,
      ...(input.verifierId === undefined ? {} : { verifierId: input.verifierId }),
      mailboxSize: mailbox.mailboxSize,
      notificationCount: mailbox.notificationCount,
      coverage: mailbox.coverage,
      verificationIds: mailbox.verificationIds,
      notificationIds: mailbox.notificationIds,
      unnotifiedVerificationIds: mailbox.unnotifiedVerificationIds,
      orphanNotificationIds: mailbox.orphanNotificationIds,
      items: mailbox.items.map((record) => ({
        id: record.id,
        verifierId: record.verifierId,
        requirement: record.requirement,
        status: record.status,
        ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
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
        ...(record.verificationId === undefined ? {} : { verificationId: record.verificationId }),
      })),
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}
