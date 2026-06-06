import type { SessionStore } from "@hotflow/sessions";
import {
  type TaskBackedSubagentSchedulerTick,
  type TaskBackedSubagentSchedulerTickIntent,
  projectSubagentSchedulerTickFromTaskState,
  readCommittedSessionTaskSnapshot,
} from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface SchedulerTickInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly sessionStore?: SessionStore;
}

export type SchedulerTickDispatchIntent = TaskBackedSubagentSchedulerTickIntent;

export type SchedulerTickReport = TaskBackedSubagentSchedulerTick & {
  readonly status: "ok";
};

export async function runSchedulerTickJob(input: SchedulerTickInput): Promise<SchedulerTickReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);

  try {
    const snapshot = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const schedulerTick = projectSubagentSchedulerTickFromTaskState(snapshot.taskState, {
      sessionId: input.sessionId,
      latestTurnId: snapshot.latestTurnId,
      ...(snapshot.latestTurnId === null ? {} : { parentTurnId: snapshot.latestTurnId }),
    });

    return {
      ...schedulerTick,
      status: "ok",
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}
