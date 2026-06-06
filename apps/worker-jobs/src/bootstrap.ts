import { type HotflowConfig, type LoadConfigOptions, loadConfig } from "@hotflow/config";
import { SessionStore } from "@hotflow/sessions";
import { SkillSnapshotFileStore, resolveApprovedSkillSnapshotPath } from "@hotflow/skills";

import { runTrajectorySummaryJob } from "./jobs/trajectory-summary.js";
import { listDelegationMailboxJob } from "./list-mailbox.js";
import { listVerifierMailboxJob } from "./list-verifier-mailbox.js";
import { runSkillProposalReconcileJob } from "./reconcile-skill-proposal.js";
import { runSkillProposalReviewJob } from "./review-skill-proposal.js";
import { runDelegationJob } from "./run-delegation.js";
import { runVerificationJob } from "./run-verification.js";
import { runSchedulerExecutorJob } from "./scheduler-executor.js";
import { runSchedulerRecoveryJob } from "./scheduler-recovery.js";
import { runSchedulerTickJob } from "./scheduler-tick.js";

export interface BootstrapWorkerJobsOptions extends LoadConfigOptions {}

export interface WorkerJobsRuntime {
  readonly config: HotflowConfig;
  readonly jobs: {
    readonly trajectorySkillProposal: (
      input: Parameters<typeof runTrajectorySummaryJob>[1],
    ) => ReturnType<typeof runTrajectorySummaryJob>;
    readonly trajectorySummary: (
      input: Parameters<typeof runTrajectorySummaryJob>[1],
    ) => ReturnType<typeof runTrajectorySummaryJob>;
    readonly reconcileSkillProposal: (
      input: Omit<Parameters<typeof runSkillProposalReconcileJob>[0], "sessionStore">,
    ) => ReturnType<typeof runSkillProposalReconcileJob>;
    readonly reviewSkillProposal: (
      input: Omit<Parameters<typeof runSkillProposalReviewJob>[0], "sessionStore">,
    ) => ReturnType<typeof runSkillProposalReviewJob>;
    readonly listDelegationMailbox: (
      input: Omit<Parameters<typeof listDelegationMailboxJob>[0], "sessionStore">,
    ) => ReturnType<typeof listDelegationMailboxJob>;
    readonly listVerifierMailbox: (
      input: Omit<Parameters<typeof listVerifierMailboxJob>[0], "sessionStore">,
    ) => ReturnType<typeof listVerifierMailboxJob>;
    readonly runDelegation: (
      input: Omit<Parameters<typeof runDelegationJob>[0], "sessionStore">,
    ) => ReturnType<typeof runDelegationJob>;
    readonly runVerification: (
      input: Omit<Parameters<typeof runVerificationJob>[0], "sessionStore">,
    ) => ReturnType<typeof runVerificationJob>;
    readonly schedulerTick: (
      input: Omit<Parameters<typeof runSchedulerTickJob>[0], "sessionStore">,
    ) => ReturnType<typeof runSchedulerTickJob>;
    readonly schedulerExecutor: (
      input: Omit<Parameters<typeof runSchedulerExecutorJob>[0], "sessionStore">,
    ) => ReturnType<typeof runSchedulerExecutorJob>;
    readonly schedulerRecovery: (
      input: Omit<Parameters<typeof runSchedulerRecoveryJob>[0], "sessionStore">,
    ) => ReturnType<typeof runSchedulerRecoveryJob>;
  };
  readonly sessionStore: SessionStore;
  close(): void;
}

export function resolveWorkerSessionDbPath(
  config: { dataDir: string; sessionDbPath: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_WORKER_SESSION_DB_PATH?.trim();
  if (override) {
    return override;
  }
  return `${config.dataDir}/sessions/worker-jobs.sqlite`;
}

export const resolveWorkerJobsSessionDbPath = resolveWorkerSessionDbPath;

export function bootstrapWorkerJobs(options: BootstrapWorkerJobsOptions = {}): WorkerJobsRuntime {
  const config = loadConfig({
    ...(options.env ? { env: options.env } : {}),
  });
  const sessionStore = new SessionStore({
    dbPath: resolveWorkerSessionDbPath(config, options.env),
  });

  return {
    config,
    jobs: {
      trajectorySkillProposal(input) {
        return runTrajectorySummaryJob(sessionStore, {
          ...input,
          ...(input.approvedSkills === undefined
            ? {
                approvedSkills: new SkillSnapshotFileStore(
                  resolveApprovedSkillSnapshotPath(config, options.env),
                ).readApproved(),
              }
            : {}),
        });
      },
      trajectorySummary(input) {
        return runTrajectorySummaryJob(sessionStore, {
          ...input,
          ...(input.approvedSkills === undefined
            ? {
                approvedSkills: new SkillSnapshotFileStore(
                  resolveApprovedSkillSnapshotPath(config, options.env),
                ).readApproved(),
              }
            : {}),
        });
      },
      reconcileSkillProposal(input) {
        return runSkillProposalReconcileJob({
          ...input,
          ...(options.env ? { env: options.env } : {}),
          sessionStore,
        });
      },
      reviewSkillProposal(input) {
        return runSkillProposalReviewJob({
          ...input,
          ...(options.env ? { env: options.env } : {}),
          sessionStore,
        });
      },
      listDelegationMailbox(input) {
        return listDelegationMailboxJob({
          ...input,
          sessionStore,
        });
      },
      listVerifierMailbox(input) {
        return listVerifierMailboxJob({
          ...input,
          sessionStore,
        });
      },
      runDelegation(input) {
        return runDelegationJob({
          ...input,
          sessionStore,
        });
      },
      runVerification(input) {
        return runVerificationJob({
          ...input,
          sessionStore,
        });
      },
      schedulerTick(input) {
        return runSchedulerTickJob({
          ...input,
          sessionStore,
        });
      },
      schedulerExecutor(input) {
        return runSchedulerExecutorJob({
          ...input,
          sessionStore,
        });
      },
      schedulerRecovery(input) {
        return runSchedulerRecoveryJob({
          ...input,
          sessionStore,
        });
      },
    },
    sessionStore,
    close() {
      sessionStore.close();
    },
  };
}
