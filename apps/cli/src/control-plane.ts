import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { type HotflowConfig, loadConfig } from "@hotflow/config";
import { estimateTokens } from "@hotflow/context";
import type { ProposalRecord } from "@hotflow/contracts";
import {
  type ControlPlane,
  type ControlPlaneAction,
  type ControlPlaneResult,
  createControlPlane,
} from "@hotflow/control-plane";
import {
  DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
  DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
} from "@hotflow/director-knowledge";
import {
  type DoctorReport,
  type DoctorStatus,
  type RunDoctorOptions,
  runDoctor,
} from "@hotflow/doctor";
import type { MemoryCoreManager, MemoryEntry } from "@hotflow/memory-core";
import { InMemoryModelProviderRegistry } from "@hotflow/models";
import {
  createRuntimeDoctorMempalaceProbe,
  getDefaultRuntimeInternalPlugins,
  registerDefaultRuntimeProviders,
} from "@hotflow/runtime-bootstrap";
import type { SessionStore } from "@hotflow/sessions";
import {
  FileBackedSkillRepository,
  SKILL_SNAPSHOT_UPSERT_KIND,
  SkillProposalReviewer,
  type SkillRepositoryPort,
  SkillSafeApplyService,
  SkillSnapshotFileStore,
  decodeSkillProposal,
  resolveApprovedSkillSnapshotPath,
} from "@hotflow/skills";
import {
  SessionStoreTaskPlanePort,
  type TaskBackedSubagentRun,
  type TaskBackedSubagentSchedulerDispatchPlan,
  type TaskBackedSubagentSchedulerHeartbeat,
  type TaskBackedSubagentSchedulerRecoveryPlan,
  type TaskBackedSubagentSchedulerTick,
  type TaskOperationsState,
  projectSessionTaskState as projectPersistedTaskState,
  projectSubagentRunsFromTaskState,
  projectSubagentSchedulerHeartbeatFromTaskState,
  projectSubagentSchedulerRecoveryPlanFromTaskState,
  projectSubagentSchedulerTickFromTaskState,
  readSessionVerifierMailbox,
  readSessionWorkerMailbox,
} from "@hotflow/tasks-core";

import type { CliTelemetry } from "./bootstrap.js";
import {
  inspectDirectorKnowledgeLane,
  inspectDirectorKnowledgeRecall,
} from "./director-knowledge.js";
import { inspectDirectorMemoryLane, inspectDirectorMemoryRecall } from "./director-memory.js";
import { summarizeDirectorRouteHealthForDoctor } from "./director-route-health.js";
import { inspectDirectorStatus } from "./director-status.js";
import {
  type PromptSessionGuidanceSourceSummary,
  type PromptSessionGuidanceSummary,
  createSessionObservationSnapshot,
  createSessionPromptExplainSnapshot,
  createSessionPromptInspectSnapshot,
  createSessionResumeSnapshot,
} from "./session-observation.js";

export interface CreateCliControlPlaneOptions {
  readonly approvedSkillRepository?: SkillRepositoryPort;
  readonly memory: MemoryCoreManager;
  readonly sessionStore: SessionStore;
  readonly telemetry: CliTelemetry;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runDoctor?: (options?: RunDoctorOptions) => Promise<unknown> | unknown;
}

export interface CreateCliOperatorControlPlaneOptions {
  readonly approvedSkillRepository?: SkillRepositoryPort;
  readonly telemetry?: CliTelemetry;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runDoctor?: (options?: RunDoctorOptions) => Promise<unknown> | unknown;
}

export type CliTaskOperationsState = TaskOperationsState & {
  readonly subagentRuns: readonly TaskBackedSubagentRun[];
  readonly subagentSchedulerHeartbeat: TaskBackedSubagentSchedulerHeartbeat;
  readonly subagentSchedulerDispatchPlan: TaskBackedSubagentSchedulerDispatchPlan;
  readonly subagentSchedulerTick: CliSubagentSchedulerTick;
  readonly subagentSchedulerRecoveryPlan: TaskBackedSubagentSchedulerRecoveryPlan;
};

export type CliSubagentSchedulerTick = TaskBackedSubagentSchedulerTick;

export interface CliOnboardingPluginSummary {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
}

export interface CliOnboardingEnvironment {
  readonly profile: string;
  readonly workspaceRoot: string;
  readonly workspaceExists: boolean;
  readonly dataDir: string;
  readonly dataDirExists: boolean;
  readonly sessionDir: string;
  readonly sessionDirExists: boolean;
  readonly sessionDbPath: string;
  readonly effectiveSessionDbPath: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly permissionMode: string;
  readonly outputStyle: string;
  readonly responseLanguage: string;
}

export interface CliOnboardingRuntimeSummary {
  readonly providerIds: readonly string[];
  readonly defaultProviderAvailable: boolean;
  readonly internalPlugins: readonly CliOnboardingPluginSummary[];
  readonly approvedSkillSnapshotPath: string;
  readonly approvedSkillCount: number;
  readonly approvedSkillReadError?: string;
}

export interface CliOnboardingDirectorExecutionSummary {
  readonly status: DoctorStatus;
  readonly summaryText: string;
  readonly routeSummary?: string;
  readonly runId?: string;
  readonly reportId?: string;
  readonly runStatus?: string;
  readonly nextAction?: string;
  readonly suggestedCommands: readonly string[];
  readonly routeCounts: {
    readonly healthy: number;
    readonly degraded: number;
    readonly reroutable: number;
    readonly exhausted: number;
    readonly blocked: number;
    readonly total: number;
  };
}

export interface CliOnboardingNextStep {
  readonly title: string;
  readonly command: string;
  readonly detail: string;
}

export interface CliOnboardingReport {
  readonly sessionId: string;
  readonly status: DoctorStatus;
  readonly summaryText: string;
  readonly environment: CliOnboardingEnvironment;
  readonly runtime: CliOnboardingRuntimeSummary;
  readonly directorExecution: CliOnboardingDirectorExecutionSummary;
  readonly guidance: readonly string[];
  readonly nextSteps: readonly CliOnboardingNextStep[];
  readonly doctorReport: DoctorReport;
}

export interface CliOnboardingStatusSurface {
  readonly status: DoctorStatus;
  readonly summaryText: string;
}

export interface CliOnboardingStatusDoctorSurface extends CliOnboardingStatusSurface {
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly total: number;
  };
}

export interface CliOnboardingStatusDirectorExecutionSurface extends CliOnboardingStatusSurface {
  readonly routeSummary?: string;
  readonly runId?: string;
  readonly reportId?: string;
  readonly runStatus?: string;
  readonly nextAction?: string;
  readonly routeCounts: CliOnboardingDirectorExecutionSummary["routeCounts"];
}

export interface CliOnboardingStatusReport {
  readonly sessionId: string;
  readonly status: DoctorStatus;
  readonly readiness: "ready" | "needs-attention" | "blocked";
  readonly summaryText: string;
  readonly recommendedCommand?: string;
  readonly commands: readonly string[];
  readonly environment: CliOnboardingEnvironment;
  readonly runtime: CliOnboardingRuntimeSummary;
  readonly directorExecution: CliOnboardingDirectorExecutionSummary;
  readonly guidance: readonly string[];
  readonly nextSteps: readonly CliOnboardingNextStep[];
  readonly doctor: {
    readonly status: DoctorStatus;
    readonly summary: {
      readonly pass: number;
      readonly warn: number;
      readonly fail: number;
      readonly total: number;
    };
    readonly summaryText: string;
    readonly checks: readonly [];
  };
  readonly surfaces: {
    readonly environment: CliOnboardingStatusSurface;
    readonly doctor: CliOnboardingStatusDoctorSurface;
    readonly directorExecution: CliOnboardingStatusDirectorExecutionSurface;
  };
}

interface CliSessionCompactionResult {
  readonly sessionId: string;
  readonly compacted: boolean;
  readonly strategy: "soft" | "hard";
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly reducedTokens: number;
  readonly beforeEntryCount: number;
  readonly afterEntryCount: number;
  readonly removedEntryIds: readonly string[];
  readonly summaryEntryIds: readonly string[];
  readonly reason?: string;
}

interface CliSessionMemoryInspectionResult {
  readonly sessionId: string;
  readonly scope: "working" | "episodic" | "all";
  readonly layer0Count?: number;
  readonly layer1Count?: number;
  readonly layer0Ids: readonly string[];
  readonly layer1Ids: readonly string[];
}

interface CliSessionMemoryClearResult {
  readonly sessionId: string;
  readonly scope: "working" | "episodic" | "all";
  readonly beforeLayer0Count: number;
  readonly beforeLayer1Count: number;
  readonly layer0Cleared: number;
  readonly layer1Cleared: number;
  readonly afterLayer0Count: number;
  readonly afterLayer1Count: number;
  readonly layer0Ids: readonly string[];
  readonly layer1Ids: readonly string[];
}

interface CliSessionMemoryStatusSummary {
  readonly workingMemoryEntries: number;
  readonly episodicMemoryEntries: number;
}

export function createCliControlPlane(options: CreateCliControlPlaneOptions): ControlPlane {
  const { memory, sessionStore, telemetry } = options;
  const env = options.env ?? process.env;
  const config = loadConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env,
  });
  const approvedSkillSnapshotPath = resolveApprovedSkillSnapshotPath(config, env);
  const approvedSkillSnapshotStore = new SkillSnapshotFileStore(approvedSkillSnapshotPath);
  const skillSafeApply = new SkillSafeApplyService(approvedSkillSnapshotStore);
  const skillProposalReviewer = new SkillProposalReviewer();

  return createControlPlane({
    sessions: {
      compact(input) {
        return compactSessionContext(
          sessionStore,
          memory,
          input.sessionId,
          input.strategy ?? "soft",
        );
      },
      resume(input) {
        ensureSession(sessionStore, input.sessionId);
        const snapshot = createSessionResumeSnapshot(
          sessionStore,
          {
            sessionId: input.sessionId,
            ...(input.checkpointId === undefined
              ? {}
              : { requestedCheckpointId: input.checkpointId }),
          },
          {
            defaultProviderId: config.defaultProvider,
            defaultModel: config.defaultModel,
          },
        );
        if (
          input.checkpointId !== undefined &&
          snapshot.checkpointId !== null &&
          snapshot.checkpointId !== input.checkpointId
        ) {
          throw new Error(
            `Resume only supports the current checkpoint (${snapshot.checkpointId}); use rewind to move the session head first.`,
          );
        }
        if (input.checkpointId !== undefined && snapshot.checkpointId === null) {
          throw new Error(
            `Resume cannot target checkpoint "${input.checkpointId}" because this session has no current checkpoint.`,
          );
        }
        return snapshot;
      },
      rewind(input) {
        return sessionStore.rewind(input.sessionId, {
          ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
        });
      },
      status(input) {
        ensureSession(sessionStore, input.sessionId);
        const snapshot = createSessionObservationSnapshot(sessionStore, {
          sessionId: input.sessionId,
          ...(input.observe?.turnId ? { turnId: input.observe.turnId } : {}),
          ...(input.observe?.limit !== undefined ? { limit: input.observe.limit } : {}),
        });

        return {
          ...attachEffectiveGuidanceToStatusSnapshot(config, snapshot),
          ...summarizeSessionMemoryStatus(memory, input.sessionId),
        };
      },
      promptInspect(input) {
        ensureSession(sessionStore, input.sessionId);
        const snapshot = createSessionPromptInspectSnapshot(sessionStore, {
          sessionId: input.sessionId,
          ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
          ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }),
        });
        return attachEffectiveGuidanceToPromptInspectSnapshot(config, snapshot);
      },
      promptExplain(input) {
        ensureSession(sessionStore, input.sessionId);
        const snapshot = createSessionPromptExplainSnapshot(sessionStore, {
          sessionId: input.sessionId,
          ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
          ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }),
        });
        return attachEffectiveGuidanceToPromptExplainSnapshot(config, snapshot);
      },
    },
    context: {
      setOutputStyle(input) {
        const updated = updateSessionPreference(sessionStore, input.sessionId, {
          key: "outputStyle",
          value: input.style,
          eventType: "control.output_style",
        });
        return attachEffectiveGuidanceToControlPreferenceResult(config, {
          sessionId: updated.sessionId,
          ...(updated.previousValue === undefined ? {} : { previousStyle: updated.previousValue }),
          style: input.style,
          ...(updated.sessionGuidance === undefined
            ? {}
            : { sessionGuidance: updated.sessionGuidance }),
          metadata: updated.metadata,
        });
      },
      setResponseLanguage(input) {
        const updated = updateSessionPreference(sessionStore, input.sessionId, {
          key: "responseLanguage",
          value: input.language,
          eventType: "control.response_language",
        });
        return attachEffectiveGuidanceToControlPreferenceResult(config, {
          sessionId: updated.sessionId,
          ...(updated.previousValue === undefined
            ? {}
            : { previousLanguage: updated.previousValue }),
          language: input.language,
          ...(updated.sessionGuidance === undefined
            ? {}
            : { sessionGuidance: updated.sessionGuidance }),
          metadata: updated.metadata,
        });
      },
    },
    policy: {
      setPermissionMode(input) {
        const updated = updateSessionPreference(sessionStore, input.sessionId, {
          key: "permissionMode",
          value: input.mode,
          eventType: "control.permission_mode",
        });
        return attachEffectiveGuidanceToControlPreferenceResult(config, {
          sessionId: updated.sessionId,
          ...(updated.previousValue === undefined ? {} : { previousMode: updated.previousValue }),
          mode: input.mode,
          ...(updated.sessionGuidance === undefined
            ? {}
            : { sessionGuidance: updated.sessionGuidance }),
          metadata: updated.metadata,
        });
      },
    },
    memory: {
      inspect(input) {
        ensureSession(sessionStore, input.sessionId);
        const scope = input.scope ?? "all";
        const occurredAtMs = Date.now();
        const inspection = inspectSessionMemory(memory, input.sessionId, scope);

        sessionStore.appendJournal(input.sessionId, {
          eventType: "control.memory_inspect",
          payload: {
            scope: inspection.scope,
            ...(inspection.layer0Count === undefined
              ? {}
              : { layer0Count: inspection.layer0Count }),
            ...(inspection.layer1Count === undefined
              ? {}
              : { layer1Count: inspection.layer1Count }),
            layer0Ids: [...inspection.layer0Ids],
            layer1Ids: [...inspection.layer1Ids],
          },
          createdAtMs: occurredAtMs,
        });

        return inspection;
      },
      clear(input) {
        ensureSession(sessionStore, input.sessionId);
        const scope = input.scope ?? "all";
        const occurredAtMs = Date.now();
        const cleared = clearSessionMemory(memory, input.sessionId, scope);

        sessionStore.appendJournal(input.sessionId, {
          eventType: "control.memory_clear",
          payload: {
            scope: cleared.scope,
            beforeLayer0Count: cleared.beforeLayer0Count,
            beforeLayer1Count: cleared.beforeLayer1Count,
            layer0Cleared: cleared.layer0Cleared,
            layer1Cleared: cleared.layer1Cleared,
            afterLayer0Count: cleared.afterLayer0Count,
            afterLayer1Count: cleared.afterLayer1Count,
            layer0Ids: [...cleared.layer0Ids],
            layer1Ids: [...cleared.layer1Ids],
          },
          createdAtMs: occurredAtMs,
        });

        return cleared;
      },
    },
    operator: createCliOperatorPort(options),
    tasks: {
      status(input) {
        return projectSessionTaskState(sessionStore, input.sessionId);
      },
      workerMailbox(input) {
        return readSessionWorkerMailbox(sessionStore, input.sessionId, {
          ...(input.workerId === undefined ? {} : { workerId: input.workerId }),
        });
      },
      verifierMailbox(input) {
        return readSessionVerifierMailbox(sessionStore, input.sessionId, {
          ...(input.verifierId === undefined ? {} : { verifierId: input.verifierId }),
        });
      },
      enqueueDelegation(input) {
        return createTaskPlane(sessionStore, input.sessionId).enqueueDelegation(input.delegation);
      },
      setDelegationStatus(input) {
        return createTaskPlane(sessionStore, input.sessionId).setDelegationStatus(input.update);
      },
      upsertVerification(input) {
        return createTaskPlane(sessionStore, input.sessionId).upsertVerification(
          input.verification,
        );
      },
      enqueueProposal(input) {
        return createTaskPlane(sessionStore, input.sessionId).enqueueProposal(input.proposal);
      },
      transitionProposal(input) {
        return createTaskPlane(sessionStore, input.sessionId).transitionProposal({
          proposalId: input.proposalId,
          status: input.status,
          ...(input.decisionNote === undefined ? {} : { decisionNote: input.decisionNote }),
        });
      },
      getProposal(input) {
        return createTaskPlane(sessionStore, input.sessionId).getProposal(input.proposalId);
      },
      async previewProposal(input) {
        const proposal = await createTaskPlane(sessionStore, input.sessionId).getProposal(
          input.proposalId,
        );
        if (!proposal) {
          throw new Error(`Unknown proposal: ${input.proposalId}`);
        }
        assertSkillProposal(proposal);
        return skillSafeApply.previewAcceptedProposal(proposal);
      },
      async listProposals(input) {
        return createTaskPlane(sessionStore, input.sessionId).listProposals({
          ...(input.status === undefined ? {} : { statuses: [input.status] }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
      },
      async reviewProposal(input) {
        const proposal = await createTaskPlane(sessionStore, input.sessionId).getProposal(
          input.proposalId,
        );
        if (!proposal) {
          throw new Error(`Unknown proposal: ${input.proposalId}`);
        }
        return reviewCliProposal(proposal, skillProposalReviewer);
      },
      async explainProposal(input) {
        const proposal = await createTaskPlane(sessionStore, input.sessionId).getProposal(
          input.proposalId,
        );
        if (!proposal) {
          throw new Error(`Unknown proposal: ${input.proposalId}`);
        }
        return explainCliProposal(proposal);
      },
      acceptProposal(input) {
        return createTaskPlane(sessionStore, input.sessionId).transitionProposal({
          proposalId: input.proposalId,
          status: "accepted",
          ...(input.decisionNote === undefined ? {} : { decisionNote: input.decisionNote }),
        });
      },
      rejectProposal(input) {
        return createTaskPlane(sessionStore, input.sessionId).transitionProposal({
          proposalId: input.proposalId,
          status: "rejected",
          ...(input.decisionNote === undefined ? {} : { decisionNote: input.decisionNote }),
        });
      },
      async applyProposal(input) {
        requireExistingSession(sessionStore, input.sessionId);
        const taskPlane = createTaskPlane(sessionStore, input.sessionId, {
          createIfMissing: false,
        });
        const proposal = await taskPlane.getProposal(input.proposalId);
        if (!proposal) {
          throw new Error(`Unknown proposal: ${input.proposalId}`);
        }
        if (proposal.kind === SKILL_SNAPSHOT_UPSERT_KIND) {
          if (proposal.status !== "accepted") {
            throw new Error(`Proposal must be accepted before apply: ${input.proposalId}`);
          }
          const applyResult = skillSafeApply.applyAcceptedProposal(proposal);

          try {
            const nextState = await taskPlane.transitionProposal({
              proposalId: input.proposalId,
              status: "applied",
            });
            recordSkillProposalApplyAudit(telemetry, {
              sessionId: input.sessionId,
              snapshotPath: approvedSkillSnapshotPath,
              ...applyResult,
            });
            return nextState;
          } catch (error) {
            try {
              skillSafeApply.revertAppliedProposal(applyResult);
            } catch (recoveryError) {
              throw new Error(
                `Skill proposal apply failed after snapshot write and recovery failed: apply=${normalizeError(
                  error,
                )}; recovery=${normalizeError(recoveryError)}`,
              );
            }

            throw new Error(
              `Skill proposal apply failed while persisting proposal state; restored approved snapshot head. cause=${normalizeError(
                error,
              )}`,
            );
          }
        }
        return taskPlane.applyProposal(input.proposalId);
      },
      rollbackProposal(input) {
        requireExistingSession(sessionStore, input.sessionId);
        const rollbackResult = skillSafeApply.rollbackToVersion(input.version);
        recordSkillRollbackAudit(telemetry, {
          sessionId: input.sessionId,
          snapshotPath: approvedSkillSnapshotPath,
          ...rollbackResult,
        });
        return rollbackResult;
      },
      drainProposalOutbox(input) {
        return createTaskPlane(sessionStore, input.sessionId).drainProposalOutbox(input.limit);
      },
    },
    hooks: {
      afterAction(action, result) {
        recordControlActionAudit(telemetry, action, result);
      },
      onError(action, error) {
        telemetry.recordAuditEvent({
          sessionId: action.sessionId,
          kind: "control.action",
          payload: {
            action: action.type,
            ok: false,
            error: normalizeError(error),
          },
        });
      },
    },
  });
}

export function createCliOperatorControlPlane(
  options: CreateCliOperatorControlPlaneOptions = {},
): ControlPlane {
  const telemetry = options.telemetry ?? {
    recordAuditEvent() {
      // Operator-only control plane intentionally avoids runtime audit persistence.
    },
  };

  return createControlPlane({
    sessions: {
      compact() {
        throw new Error("compact is unavailable in the operator-only control-plane.");
      },
      resume() {
        throw new Error("resume is unavailable in the operator-only control-plane.");
      },
      rewind() {
        throw new Error("rewind is unavailable in the operator-only control-plane.");
      },
      status() {
        throw new Error("status is unavailable in the operator-only control-plane.");
      },
      promptInspect() {
        throw new Error("prompt-inspect is unavailable in the operator-only control-plane.");
      },
      promptExplain() {
        throw new Error("prompt-explain is unavailable in the operator-only control-plane.");
      },
    },
    context: {
      setOutputStyle() {
        throw new Error("output-style is unavailable in the operator-only control-plane.");
      },
      setResponseLanguage() {
        throw new Error("language is unavailable in the operator-only control-plane.");
      },
    },
    policy: {
      setPermissionMode() {
        throw new Error("permissions is unavailable in the operator-only control-plane.");
      },
    },
    memory: {
      inspect() {
        throw new Error("memory-inspect is unavailable in the operator-only control-plane.");
      },
      clear() {
        throw new Error("memory-clear is unavailable in the operator-only control-plane.");
      },
    },
    operator: createCliOperatorPort(options),
    tasks: {
      status() {
        throw new Error("task-status is unavailable in the operator-only control-plane.");
      },
      workerMailbox() {
        throw new Error("task-worker-mailbox is unavailable in the operator-only control-plane.");
      },
      verifierMailbox() {
        throw new Error("task-verifier-mailbox is unavailable in the operator-only control-plane.");
      },
      enqueueDelegation() {
        throw new Error("delegation-enqueue is unavailable in the operator-only control-plane.");
      },
      setDelegationStatus() {
        throw new Error("delegation-status is unavailable in the operator-only control-plane.");
      },
      upsertVerification() {
        throw new Error("verification-upsert is unavailable in the operator-only control-plane.");
      },
      enqueueProposal() {
        throw new Error("proposal-enqueue is unavailable in the operator-only control-plane.");
      },
      transitionProposal() {
        throw new Error("proposal-transition is unavailable in the operator-only control-plane.");
      },
      getProposal() {
        throw new Error("proposal-get is unavailable in the operator-only control-plane.");
      },
      previewProposal() {
        throw new Error("proposal-preview is unavailable in the operator-only control-plane.");
      },
      listProposals() {
        throw new Error("proposal-list is unavailable in the operator-only control-plane.");
      },
      reviewProposal() {
        throw new Error("proposal-review is unavailable in the operator-only control-plane.");
      },
      explainProposal() {
        throw new Error("proposal-explain is unavailable in the operator-only control-plane.");
      },
      acceptProposal() {
        throw new Error("proposal-accept is unavailable in the operator-only control-plane.");
      },
      rejectProposal() {
        throw new Error("proposal-reject is unavailable in the operator-only control-plane.");
      },
      applyProposal() {
        throw new Error("proposal-apply is unavailable in the operator-only control-plane.");
      },
      rollbackProposal() {
        throw new Error("proposal-rollback is unavailable in the operator-only control-plane.");
      },
      drainProposalOutbox() {
        throw new Error("proposal-outbox-drain is unavailable in the operator-only control-plane.");
      },
    },
    hooks: {
      afterAction(action, result) {
        recordControlActionAudit(telemetry, action, result);
      },
      onError(action, error) {
        telemetry.recordAuditEvent({
          sessionId: action.sessionId,
          kind: "control.action",
          payload: {
            action: action.type,
            ok: false,
            error: normalizeError(error),
          },
        });
      },
    },
  });
}

export function projectSessionTaskState(
  sessionStore: SessionStore,
  sessionId: string,
): CliTaskOperationsState {
  const taskState = projectPersistedTaskState(sessionStore, sessionId);
  const subagentRuns = projectSubagentRunsFromTaskState(taskState);
  const schedulerTick = projectSubagentSchedulerTickFromTaskState(taskState, {
    sessionId,
    latestTurnId: null,
  });
  return {
    ...taskState,
    subagentRuns,
    subagentSchedulerHeartbeat: projectSubagentSchedulerHeartbeatFromTaskState(taskState),
    subagentSchedulerDispatchPlan: schedulerTick.dispatchPlan,
    subagentSchedulerTick: schedulerTick,
    subagentSchedulerRecoveryPlan: projectSubagentSchedulerRecoveryPlanFromTaskState(taskState),
  };
}

function createCliOperatorPort(
  options: Pick<
    CreateCliControlPlaneOptions,
    "approvedSkillRepository" | "cwd" | "env" | "runDoctor"
  >,
) {
  return {
    doctor() {
      const runDoctorImpl = options.runDoctor ?? runDoctor;
      return runDoctorImpl(createCliDoctorRunOptions(options));
    },
    onboarding(input: { sessionId: string }) {
      return buildCliOnboardingReport({
        sessionId: input.sessionId,
        ...(options.approvedSkillRepository === undefined
          ? {}
          : { approvedSkillRepository: options.approvedSkillRepository }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.runDoctor === undefined ? {} : { runDoctor: options.runDoctor }),
      });
    },
    async onboardingStatus(input: { sessionId: string }) {
      const report = await buildCliOnboardingReport({
        sessionId: input.sessionId,
        ...(options.approvedSkillRepository === undefined
          ? {}
          : { approvedSkillRepository: options.approvedSkillRepository }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.runDoctor === undefined ? {} : { runDoctor: options.runDoctor }),
      });
      return buildCliOnboardingStatusReport(report);
    },
  };
}

async function buildCliOnboardingReport(options: {
  readonly sessionId: string;
  readonly approvedSkillRepository?: SkillRepositoryPort;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runDoctor?: (options?: RunDoctorOptions) => Promise<unknown> | unknown;
}): Promise<CliOnboardingReport> {
  const env = options.env ?? process.env;
  const config = loadConfig({
    cwd: options.cwd ?? process.cwd(),
    env,
  });
  const environment = buildCliOnboardingEnvironment(config, env);
  const runtime = buildCliOnboardingRuntimeSummary(config, env, options.approvedSkillRepository);
  const directorExecution = await buildCliOnboardingDirectorExecutionSummary(config.workspaceRoot);
  const runDoctorImpl = options.runDoctor ?? runDoctor;
  const doctorReport = (await runDoctorImpl(createCliDoctorRunOptions(options))) as DoctorReport;
  const status = deriveCliOnboardingStatus(
    doctorReport.status,
    environment,
    runtime,
    directorExecution,
  );

  return {
    sessionId: options.sessionId,
    status,
    summaryText: buildCliOnboardingSummaryText(status, doctorReport, runtime, directorExecution),
    environment,
    runtime,
    directorExecution,
    guidance: buildCliOnboardingGuidance(environment, runtime, doctorReport, directorExecution),
    nextSteps: buildCliOnboardingNextSteps(config, runtime, directorExecution),
    doctorReport,
  };
}

function buildCliOnboardingEnvironment(
  config: HotflowConfig,
  env: NodeJS.ProcessEnv,
): CliOnboardingEnvironment {
  const effectiveSessionDbPath = resolveCliSessionDbPathForOperator(config, env);
  const sessionDir = dirname(effectiveSessionDbPath);

  return {
    profile: config.profile,
    workspaceRoot: config.workspaceRoot,
    workspaceExists: existsSync(config.workspaceRoot),
    dataDir: config.dataDir,
    dataDirExists: existsSync(config.dataDir),
    sessionDir,
    sessionDirExists: existsSync(sessionDir),
    sessionDbPath: config.sessionDbPath,
    effectiveSessionDbPath,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    permissionMode: config.permissionMode,
    outputStyle: config.outputStyle,
    responseLanguage: config.responseLanguage,
  };
}

function buildCliOnboardingRuntimeSummary(
  config: HotflowConfig,
  env: NodeJS.ProcessEnv,
  approvedSkillRepository?: SkillRepositoryPort,
): CliOnboardingRuntimeSummary {
  const providerRegistry = new InMemoryModelProviderRegistry();
  const providerIds = registerDefaultRuntimeProviders(providerRegistry, { env });
  const approvedSkillSnapshotPath = resolveApprovedSkillSnapshotPath(config, env);
  const repository =
    approvedSkillRepository ??
    new FileBackedSkillRepository(new SkillSnapshotFileStore(approvedSkillSnapshotPath));

  let approvedSkillCount = 0;
  let approvedSkillReadError: string | undefined;
  try {
    approvedSkillCount = repository.listApproved().length;
  } catch (error) {
    approvedSkillReadError = normalizeError(error);
  }

  return {
    providerIds,
    defaultProviderAvailable: providerIds.includes(config.defaultProvider),
    internalPlugins: getDefaultRuntimeInternalPlugins().map((plugin) => ({
      id: plugin.id,
      kind: plugin.kind,
      displayName: plugin.displayName,
      capabilities: [...plugin.capabilities],
    })),
    approvedSkillSnapshotPath,
    approvedSkillCount,
    ...(approvedSkillReadError === undefined ? {} : { approvedSkillReadError }),
  };
}

function deriveCliOnboardingStatus(
  doctorStatus: DoctorStatus,
  environment: CliOnboardingEnvironment,
  runtime: CliOnboardingRuntimeSummary,
  directorExecution: CliOnboardingDirectorExecutionSummary,
): DoctorStatus {
  let status = doctorStatus;

  if (!environment.workspaceExists || !environment.dataDirExists || !environment.sessionDirExists) {
    status = maxCliOnboardingStatus(status, "warn");
  }
  if (runtime.approvedSkillReadError) {
    status = maxCliOnboardingStatus(status, "warn");
  }
  status = maxCliOnboardingStatus(status, directorExecution.status);

  return status;
}

function maxCliOnboardingStatus(left: DoctorStatus, right: DoctorStatus): DoctorStatus {
  const order: Record<DoctorStatus, number> = {
    pass: 0,
    warn: 1,
    fail: 2,
  };

  const leftRank = order[left] ?? 0;
  const rightRank = order[right] ?? 0;
  return leftRank >= rightRank ? left : right;
}

function buildCliOnboardingSummaryText(
  status: DoctorStatus,
  doctorReport: DoctorReport,
  runtime: CliOnboardingRuntimeSummary,
  directorExecution: CliOnboardingDirectorExecutionSummary,
): string {
  const providerCheck = findDoctorCheck(doctorReport, "provider.default");
  if (status === "fail" && providerCheck?.status === "fail") {
    return providerCheck.summary;
  }
  if (directorExecution.status === "fail") {
    return directorExecution.summaryText;
  }
  if (runtime.approvedSkillReadError) {
    return [
      "Director Angel OS can start, but approved skill visibility needs attention before you rely on snapshot-based workflows.",
      "Director Angel OS 可以启动，但在依赖已批准技能快照工作流之前，需要先处理技能可见性问题。",
    ].join("\n");
  }
  if (directorExecution.status === "warn") {
    return directorExecution.summaryText;
  }
  if (status === "warn") {
    return [
      "Director Angel OS can start, but a few optional or recommended capabilities still need attention.",
      "Director Angel OS 可以启动，但仍有一些可选或推荐能力需要补齐。",
    ].join("\n");
  }
  return [
    "Director Angel OS runtime looks ready. You can run your first prompt now.",
    "Director Angel OS 运行时已准备就绪，现在可以发起第一条提示词。",
  ].join("\n");
}

function buildCliOnboardingGuidance(
  environment: CliOnboardingEnvironment,
  runtime: CliOnboardingRuntimeSummary,
  doctorReport: DoctorReport,
  directorExecution: CliOnboardingDirectorExecutionSummary,
): readonly string[] {
  const guidance = [
    `Workspace state lives under ${environment.dataDir}; CLI session state resolves to ${environment.effectiveSessionDbPath}. / 工作区状态位于 ${environment.dataDir}；CLI 会话状态写入 ${environment.effectiveSessionDbPath}。`,
    `Internal plugins ship as built-in read-only capabilities: ${formatPluginHint(runtime.internalPlugins)}. / 内置插件随仓库提供，为只读能力：${formatPluginHint(runtime.internalPlugins)}。`,
    `Approved skills are loaded from ${runtime.approvedSkillSnapshotPath}; new skills become visible only after proposal review, safe apply, and reload. / 已批准技能从 ${runtime.approvedSkillSnapshotPath} 加载；新技能只有在提案审阅、安全应用并重载后才会生效。`,
  ];

  if (!runtime.defaultProviderAvailable && environment.defaultProvider === "openai-compatible") {
    guidance.push(
      "To use the openai-compatible provider, set HOTFLOW_OPENAI_BASE_URL and optionally HOTFLOW_OPENAI_API_KEY / HOTFLOW_OPENAI_PROVIDER_ID, then rerun onboarding. / 如需启用 openai-compatible provider，请设置 HOTFLOW_OPENAI_BASE_URL，以及可选的 HOTFLOW_OPENAI_API_KEY / HOTFLOW_OPENAI_PROVIDER_ID，然后重新执行 onboarding。",
    );
  }

  const mempalaceCheck = findDoctorCheck(doctorReport, "memory.mempalace");
  if (mempalaceCheck?.status === "warn") {
    guidance.push(
      "Mempalace is optional for this open-source starter. Leave it disabled, or configure HOTFLOW_MEMPALACE_COMMAND and HOTFLOW_MEMPALACE_PALACE_PATH before enabling optional recall. / 对当前开源首发版本而言，Mempalace 是可选项；保持关闭即可，或先配置 HOTFLOW_MEMPALACE_COMMAND 和 HOTFLOW_MEMPALACE_PALACE_PATH，再启用可选 recall。",
    );
  }

  if (runtime.approvedSkillReadError) {
    guidance.push(
      `Approved skill snapshot could not be read: ${runtime.approvedSkillReadError} / 已批准技能快照读取失败：${runtime.approvedSkillReadError}`,
    );
  }
  if (directorExecution.routeSummary) {
    guidance.push(
      `Latest director route summary: ${directorExecution.routeSummary} / 最新导演链路摘要：${directorExecution.routeSummary}`,
    );
  }
  if (directorExecution.nextAction) {
    guidance.push(
      `Latest director next action: ${directorExecution.nextAction} / 最新导演建议动作：${directorExecution.nextAction}`,
    );
  }
  for (const command of directorExecution.suggestedCommands) {
    guidance.push(
      `Director recovery command: \`${command}\` / 可直接执行的导演恢复命令：\`${command}\``,
    );
  }

  return guidance;
}

function buildCliOnboardingNextSteps(
  config: HotflowConfig,
  runtime: CliOnboardingRuntimeSummary,
  directorExecution: CliOnboardingDirectorExecutionSummary,
): readonly CliOnboardingNextStep[] {
  const nextSteps: CliOnboardingNextStep[] = [];

  if (!runtime.defaultProviderAvailable && config.defaultProvider === "openai-compatible") {
    nextSteps.push({
      title: "Configure provider / 配置 Provider",
      command: "export HOTFLOW_OPENAI_BASE_URL=<https://your-endpoint/v1>",
      detail:
        "If your provider requires auth, also set HOTFLOW_OPENAI_API_KEY, then rerun `hotflow onboard`. / 如果 provider 需要鉴权，再设置 HOTFLOW_OPENAI_API_KEY，然后重新运行 `hotflow onboard`。",
    });
  }
  nextSteps.push(...buildDirectorExecutionNextSteps(directorExecution));

  nextSteps.push({
    title: "Run doctor / 运行 doctor",
    command: "hotflow doctor",
    detail:
      "Recheck provider, session DB, runtime bootstrap, and optional Mempalace health. / 重新检查 provider、session DB、runtime bootstrap 和可选的 Mempalace 健康状态。",
  });
  nextSteps.push({
    title: "Start first session / 开始第一次会话",
    command: 'hotflow run "Read README.md and summarize the project."',
    detail: `Runs with default provider \`${config.defaultProvider}\` and model \`${config.defaultModel}\`. / 将使用默认 provider \`${config.defaultProvider}\` 和 model \`${config.defaultModel}\` 运行。`,
  });
  nextSteps.push({
    title: "Inspect session state / 查看会话状态",
    command: "hotflow status <sessionId>",
    detail:
      "After the first run, inspect recovery, audit, and stream state through the control plane. / 首次运行后，可通过 control plane 查看恢复、审计和流式状态。",
  });

  return nextSteps;
}

function buildCliOnboardingStatusReport(report: CliOnboardingReport): CliOnboardingStatusReport {
  const commands = collectCliOnboardingCommands(report);
  const doctorSurface = deriveCliOnboardingDoctorSurface(report.doctorReport);

  return {
    sessionId: report.sessionId,
    status: report.status,
    readiness: deriveCliOnboardingReadiness(report.status),
    summaryText: report.summaryText,
    ...(commands[0] === undefined ? {} : { recommendedCommand: commands[0] }),
    commands,
    environment: report.environment,
    runtime: report.runtime,
    directorExecution: report.directorExecution,
    guidance: report.guidance,
    nextSteps: report.nextSteps,
    doctor: {
      status: doctorSurface.status,
      summary: doctorSurface.counts,
      summaryText: doctorSurface.summaryText,
      checks: [],
    },
    surfaces: {
      environment: deriveCliOnboardingEnvironmentSurface(report.environment),
      doctor: doctorSurface,
      directorExecution: deriveCliOnboardingDirectorExecutionSurface(report.directorExecution),
    },
  };
}

function collectCliOnboardingCommands(report: CliOnboardingReport): readonly string[] {
  const commands = [
    ...report.directorExecution.suggestedCommands,
    ...report.nextSteps.map((step) => step.command),
  ];

  return [...new Set(commands.filter((command) => command.trim().length > 0))];
}

function deriveCliOnboardingReadiness(
  status: DoctorStatus,
): CliOnboardingStatusReport["readiness"] {
  if (status === "fail") {
    return "blocked";
  }
  if (status === "warn") {
    return "needs-attention";
  }
  return "ready";
}

function deriveCliOnboardingEnvironmentSurface(
  environment: CliOnboardingEnvironment,
): CliOnboardingStatusSurface {
  if (!environment.workspaceExists) {
    return {
      status: "warn",
      summaryText:
        "Workspace root is not visible yet. Verify HOTFLOW_WORKSPACE_ROOT before the first real run.",
    };
  }

  if (!environment.dataDirExists || !environment.sessionDirExists) {
    return {
      status: "warn",
      summaryText:
        "Workspace is visible, but operator state directories are not fully materialized yet; the first bounded run will create them.",
    };
  }

  return {
    status: "pass",
    summaryText: "Workspace root and operator state paths are visible.",
  };
}

function deriveCliOnboardingDoctorSurface(
  doctorReport: DoctorReport,
): CliOnboardingStatusDoctorSurface {
  const counts = {
    pass: 0,
    warn: 0,
    fail: 0,
    total: doctorReport.checks.length,
  };

  for (const check of doctorReport.checks) {
    if (check.status === "pass" || check.status === "warn" || check.status === "fail") {
      counts[check.status] += 1;
    }
  }

  return {
    status: doctorReport.status,
    summaryText: `${counts.total} checks (${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail).`,
    counts,
  };
}

function deriveCliOnboardingDirectorExecutionSurface(
  directorExecution: CliOnboardingDirectorExecutionSummary,
): CliOnboardingStatusDirectorExecutionSurface {
  return {
    status: directorExecution.status,
    summaryText: directorExecution.summaryText,
    ...(directorExecution.routeSummary === undefined
      ? {}
      : { routeSummary: directorExecution.routeSummary }),
    ...(directorExecution.runId === undefined ? {} : { runId: directorExecution.runId }),
    ...(directorExecution.reportId === undefined ? {} : { reportId: directorExecution.reportId }),
    ...(directorExecution.runStatus === undefined
      ? {}
      : { runStatus: directorExecution.runStatus }),
    ...(directorExecution.nextAction === undefined
      ? {}
      : { nextAction: directorExecution.nextAction }),
    routeCounts: directorExecution.routeCounts,
  };
}

async function buildCliOnboardingDirectorExecutionSummary(
  workspaceRoot: string,
): Promise<CliOnboardingDirectorExecutionSummary> {
  const emptyCounts = createEmptyDirectorRouteCounts();
  const status = await inspectDirectorStatus(workspaceRoot);
  const latestReport = status.latestReport;

  if (!latestReport) {
    return {
      status: "pass",
      summaryText: [
        "No persisted director execution report exists yet. Run one bounded director flow first if you want route diagnosis here.",
        "当前还没有持久化的导演执行报告；如果想在这里看到链路诊断，请先跑一次受控的 director 流程。",
      ].join("\n"),
      suggestedCommands: [],
      routeCounts: emptyCounts,
    };
  }

  if (!latestReport.routeHealth || latestReport.routeHealth.length === 0) {
    return {
      status: "warn",
      summaryText: [
        "The latest director execution report is missing the chain route health snapshot, so onboarding cannot give a precise recovery verdict yet.",
        "最新的导演执行报告缺少链路健康快照，因此 onboarding 暂时无法给出精确的恢复判断。",
      ].join("\n"),
      routeSummary: "Latest execution report is missing the chain route health snapshot.",
      runId: latestReport.runId,
      reportId: latestReport.reportId,
      runStatus: latestReport.runStatus,
      ...(latestReport.nextAction === undefined ? {} : { nextAction: latestReport.nextAction }),
      suggestedCommands: [`hotflow director run explain --run-id ${latestReport.runId}`],
      routeCounts: emptyCounts,
    };
  }

  const diagnosis = summarizeDirectorRouteHealthForDoctor(latestReport.routeHealth);
  const readyAssignmentCount = countDirectorReadyAssignments(diagnosis.entries);
  return {
    status: diagnosis.status,
    summaryText: buildDirectorExecutionSummaryText(diagnosis.status, readyAssignmentCount),
    routeSummary: diagnosis.summary,
    runId: latestReport.runId,
    reportId: latestReport.reportId,
    runStatus: latestReport.runStatus,
    ...(diagnosis.status === "pass" && readyAssignmentCount > 0
      ? {
          nextAction: buildDirectorReadyAssignmentsNextAction(readyAssignmentCount),
        }
      : latestReport.nextAction !== undefined
        ? { nextAction: latestReport.nextAction }
        : (() => {
            const action = diagnosis.entries.find((entry) => entry.nextAction)?.nextAction;
            if (action !== undefined) {
              return { nextAction: action };
            }
            if (readyAssignmentCount > 0) {
              return {
                nextAction: buildDirectorReadyAssignmentsNextAction(readyAssignmentCount),
              };
            }
            return {};
          })()),
    suggestedCommands: buildDirectorExecutionSuggestedCommands(
      latestReport.runId,
      diagnosis,
      readyAssignmentCount,
    ),
    routeCounts: diagnosis.counts,
  };
}

function createEmptyDirectorRouteCounts(): CliOnboardingDirectorExecutionSummary["routeCounts"] {
  return {
    healthy: 0,
    degraded: 0,
    reroutable: 0,
    exhausted: 0,
    blocked: 0,
    total: 0,
  };
}

function buildDirectorExecutionSummaryText(status: DoctorStatus, readyAssignmentCount = 0): string {
  if (status === "fail") {
    return [
      "The latest director execution chain is blocked or exhausted and needs operator repair before it can continue.",
      "最新的导演执行链路已经阻塞或耗尽，继续之前需要先由操作员修复。",
    ].join("\n");
  }
  if (status === "warn") {
    return [
      "The latest director execution chain is degraded but still recoverable if the operator follows the bounded retry or reroute path.",
      "最新的导演执行链路虽然降级，但只要操作员按受控的 retry 或 reroute 路径处理，仍然可以恢复。",
    ].join("\n");
  }
  if (readyAssignmentCount > 0) {
    return [
      `The latest director execution chain is healthy and has ${readyAssignmentCount} ready assignment(s) that can be advanced through the local worker lane now.`,
      `最新的导演执行链路是健康的，而且现在有 ${readyAssignmentCount} 个就绪任务可以立刻交给本地 worker lane 推进。`,
    ].join("\n");
  }
  return [
    "The latest director execution chain looks healthy.",
    "最新的导演执行链路看起来是健康的。",
  ].join("\n");
}

function buildDirectorExecutionSuggestedCommands(
  runId: string,
  diagnosis: ReturnType<typeof summarizeDirectorRouteHealthForDoctor>,
  readyAssignmentCount = 0,
): readonly string[] {
  const commands = new Set<string>();

  if (diagnosis.status === "pass" && readyAssignmentCount > 0) {
    commands.add(`hotflow director run once --run-id ${runId}`);
    return [...commands];
  }

  for (const entry of diagnosis.entries) {
    if (entry.verdict === "degraded" && entry.retryAllowed) {
      commands.add(
        `hotflow director run retry --run-id ${runId} --assignment-id ${entry.assignmentId}`,
      );
    } else if (entry.verdict === "reroutable" && entry.rerouteCandidates[0]) {
      commands.add(
        `hotflow director run reroute --run-id ${runId} --assignment-id ${entry.assignmentId} --adapter-id ${entry.rerouteCandidates[0]}`,
      );
    } else if (entry.verdict === "blocked" || entry.verdict === "exhausted") {
      commands.add(`hotflow director run explain --run-id ${runId}`);
    }

    if (commands.size >= 2) {
      break;
    }
  }

  if (commands.size === 0 && diagnosis.status !== "pass") {
    commands.add(`hotflow director run explain --run-id ${runId}`);
  }

  return [...commands];
}

function buildDirectorExecutionNextSteps(
  directorExecution: CliOnboardingDirectorExecutionSummary,
): readonly CliOnboardingNextStep[] {
  const nextSteps: CliOnboardingNextStep[] = [];
  const detail =
    directorExecution.nextAction ??
    directorExecution.routeSummary ??
    directorExecution.summaryText.split("\n")[0] ??
    "Review the latest director execution diagnosis before continuing.";

  for (const command of directorExecution.suggestedCommands) {
    nextSteps.push({
      title: classifyDirectorExecutionCommandTitle(command),
      command,
      detail,
    });
  }

  return nextSteps;
}

function classifyDirectorExecutionCommandTitle(command: string): string {
  if (command.includes("director run once")) {
    return "Run ready director assignments / 运行就绪导演任务";
  }
  if (command.includes("director run retry")) {
    return "Retry director assignment / 重试导演任务";
  }
  if (command.includes("director run reroute")) {
    return "Reroute director assignment / 改道导演任务";
  }
  return "Inspect director run / 查看导演运行诊断";
}

function countDirectorReadyAssignments(
  entries: ReturnType<typeof summarizeDirectorRouteHealthForDoctor>["entries"],
): number {
  return entries.filter((entry) => entry.status === "ready" && entry.verdict === "healthy").length;
}

function buildDirectorReadyAssignmentsNextAction(readyAssignmentCount: number): string {
  return [
    `run the ${readyAssignmentCount} ready assignment(s) through the local worker lane once.`,
    `通过本地 worker lane 先跑一次当前这 ${readyAssignmentCount} 个就绪任务。`,
  ].join("\n");
}

function findDoctorCheck(
  report: DoctorReport,
  checkId: string,
): DoctorReport["checks"][number] | undefined {
  return report.checks.find((check: DoctorReport["checks"][number]) => check.id === checkId);
}

function formatPluginHint(plugins: readonly CliOnboardingPluginSummary[]): string {
  if (plugins.length === 0) {
    return "(none)";
  }

  return plugins.map((plugin) => `${plugin.id} [${plugin.capabilities.join(", ")}]`).join(", ");
}

function createCliDoctorRunOptions(options: {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionStore?: SessionStore;
  readonly approvedSkillRepository?: SkillRepositoryPort;
}): RunDoctorOptions {
  const env = options.env ?? process.env;

  return {
    cwd: options.cwd ?? process.cwd(),
    env,
    probeMempalace: createRuntimeDoctorMempalaceProbe({ env }),
    probeDirectorMemoryLane: createCliDoctorDirectorMemoryLaneProbe({
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
    probeDirectorKnowledgeLane: createCliDoctorDirectorKnowledgeLaneProbe({
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
    probeLearningLane: createCliDoctorLearningLaneProbe({
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.sessionStore === undefined ? {} : { sessionStore: options.sessionStore }),
      ...(options.approvedSkillRepository === undefined
        ? {}
        : { approvedSkillRepository: options.approvedSkillRepository }),
    }),
    resolveSessionDbPath(input: { config: HotflowConfig; sessionDbPathOverride?: string }) {
      return resolveCliSessionDbPathForOperator(input.config, env);
    },
  };
}

function createCliDoctorDirectorMemoryLaneProbe(options: {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}) {
  return async () => {
    const env = options.env ?? process.env;
    const config = loadConfig({
      cwd: options.cwd ?? process.cwd(),
      env,
    });
    const inspection = await inspectDirectorMemoryLane(config.workspaceRoot);

    const switchState = {
      status: "pass" as const,
      summary: inspection.enabled
        ? "Director memory is enabled by switch."
        : "Director memory is intentionally disabled by switch.",
      details: {
        enabled: inspection.enabled,
        source: inspection.switchSource,
        switchPath: inspection.switchPath,
      },
    };

    const storeReadable =
      inspection.storeStatus === "degraded"
        ? {
            status: "warn" as const,
            summary: "Director memory store is degraded.",
            details: {
              status: inspection.storeStatus,
              recordCount: inspection.recordCount,
              ...(inspection.lastRecordedAt === undefined
                ? {}
                : { lastRecordedAt: inspection.lastRecordedAt }),
              notes: [...inspection.notes],
            },
          }
        : {
            status: "pass" as const,
            summary: "Director memory store is readable.",
            details: {
              status: inspection.storeStatus,
              recordCount: inspection.recordCount,
              ...(inspection.lastRecordedAt === undefined
                ? {}
                : { lastRecordedAt: inspection.lastRecordedAt }),
            },
          };

    const recallPreview = await buildDirectorMemoryRecallProbe(config.workspaceRoot, inspection);
    const ingestClosure = buildDirectorMemoryIngestProbe(inspection);

    return {
      switchState,
      storeReadable,
      recallPreview,
      ingestClosure,
    };
  };
}

function createCliDoctorLearningLaneProbe(options: {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionStore?: SessionStore;
  readonly approvedSkillRepository?: SkillRepositoryPort;
}) {
  return () => {
    const env = options.env ?? process.env;
    const config = loadConfig({
      cwd: options.cwd ?? process.cwd(),
      env,
    });
    const sessionDbPath = resolveCliSessionDbPathForOperator(config, env);
    const approvedSkillSnapshotPath = resolveApprovedSkillSnapshotPath(config, env);
    const approvedSkillRepository =
      options.approvedSkillRepository ??
      new FileBackedSkillRepository(new SkillSnapshotFileStore(approvedSkillSnapshotPath));

    let approvedSkillCount = 0;
    let approvedSnapshotStatus: DoctorStatus = "pass";
    let approvedSnapshotSummary = "Approved skill snapshot is readable.";
    let approvedSnapshotDetails: Readonly<Record<string, unknown>> = {
      approvedSkillCount: 0,
      snapshotPath: approvedSkillSnapshotPath,
      exists: existsSync(approvedSkillSnapshotPath),
    };

    try {
      approvedSkillCount = approvedSkillRepository.listApproved().length;
      approvedSnapshotDetails = {
        approvedSkillCount,
        snapshotPath: approvedSkillSnapshotPath,
        exists: existsSync(approvedSkillSnapshotPath),
      };
    } catch (error) {
      approvedSnapshotStatus = "warn";
      approvedSnapshotSummary = "Approved skill snapshot could not be read.";
      approvedSnapshotDetails = {
        approvedSkillCount: 0,
        snapshotPath: approvedSkillSnapshotPath,
        exists: existsSync(approvedSkillSnapshotPath),
        error: normalizeError(error),
      };
    }

    return {
      proposalStore: {
        status: "pass" as const,
        summary:
          "Proposal queue remains session-backed and operator-controlled through the task plane.",
        details: {
          sessionDbPath,
          storage: "session-backed-task-plane",
          authority: "session-store",
          ...(options.sessionStore === undefined ? {} : { runtimeStore: "injected" }),
        },
      },
      approvedSnapshot: {
        status: approvedSnapshotStatus,
        summary: approvedSnapshotSummary,
        details: approvedSnapshotDetails,
      },
      reloadVisibility: {
        status: "pass" as const,
        summary: "Approved skills remain reload-only and do not hot-patch the active runtime.",
        details: {
          mode: "reload-only",
          hotReloadSupported: false,
          visibilityBoundary: "process-start",
        },
      },
    };
  };
}

function createCliDoctorDirectorKnowledgeLaneProbe(options: {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}) {
  return async () => {
    const env = options.env ?? process.env;
    const config = loadConfig({
      cwd: options.cwd ?? process.cwd(),
      env,
    });
    const inspection = await inspectDirectorKnowledgeLane(config.workspaceRoot);

    const switchState = {
      status: "pass" as const,
      summary: inspection.enabled
        ? "Director knowledge recall is enabled by switch."
        : "Director knowledge recall is intentionally disabled by switch.",
      details: {
        enabled: inspection.enabled,
        source: inspection.switchSource,
        ...(inspection.switchPath === undefined ? {} : { switchPath: inspection.switchPath }),
        maxHits: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
        maxChars: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
      },
    };

    const storeReadable = {
      status: "pass" as const,
      summary: "Published Director knowledge lane is readable.",
      details: {
        publishedCount: inspection.publishedCount,
        candidateCount: inspection.candidateCount,
        reviewQueueCount: inspection.reviewQueueCount,
        rollbackCount: inspection.rollbackCount,
        ...(inspection.latestPublishedDocument === null
          ? {}
          : {
              latestPublishedAt: inspection.latestPublishedDocument.audit.publishedAt,
              latestPublishedVersion: inspection.latestPublishedDocument.metadata.version,
            }),
        ...(inspection.latestRollbackRecord === null
          ? {}
          : {
              latestRollbackAt: inspection.latestRollbackRecord.rolledBackAt,
              latestRollbackVersion: inspection.latestRollbackRecord.currentVersionAfter,
            }),
        knowledgeEvolution: inspection.knowledgeEvolution,
        candidateReady: inspection.hasCandidate,
      },
    };

    const recallPreview = await buildDirectorKnowledgeRecallProbe(config.workspaceRoot, inspection);

    return {
      switchState,
      storeReadable,
      recallPreview,
    };
  };
}

async function buildDirectorMemoryRecallProbe(
  workspaceRoot: string,
  inspection: Awaited<ReturnType<typeof inspectDirectorMemoryLane>>,
) {
  if (!inspection.enabled) {
    return {
      status: "pass" as const,
      summary: "Director memory recall is intentionally disabled by switch.",
      details: {
        status: "disabled",
        hitCount: 0,
      },
    };
  }

  const latestRecord = inspection.latestRecord;
  if (!latestRecord) {
    return {
      status: "pass" as const,
      summary: "Director memory recall preview is idle because no stored records exist yet.",
      details: {
        status: "miss",
        hitCount: 0,
      },
    };
  }

  const preview = await inspectDirectorMemoryRecall(workspaceRoot, {
    projectId: latestRecord.projectId,
    groupId: latestRecord.groupId,
    anchorIds: latestRecord.anchorIds,
    selectedAdapters: latestRecord.selectedAdapters,
    ...(latestRecord.digest.generationType === undefined
      ? {}
      : { generationType: latestRecord.digest.generationType }),
    ...(latestRecord.digest.generationStyle === undefined
      ? {}
      : { generationStyle: latestRecord.digest.generationStyle }),
    knowledgeSignalTags: latestRecord.tags ?? [],
    maxHits: 1,
  });

  const packet = preview.packet;
  const degraded = packet.status === "degraded";
  return {
    status: degraded ? ("warn" as const) : ("pass" as const),
    summary: degraded
      ? "Director memory recall preview degraded."
      : packet.status === "ok"
        ? "Director memory recall preview returned a hit."
        : "Director memory recall preview completed without blocking the operator lane.",
    details: {
      status: packet.status,
      hitCount: packet.hits.length,
      truncated: packet.truncated ?? false,
      ...(packet.hits[0] === undefined
        ? {}
        : {
            recordId: packet.hits[0].recordId,
            runId: packet.hits[0].provenance.runId,
          }),
    },
  };
}

async function buildDirectorKnowledgeRecallProbe(
  workspaceRoot: string,
  inspection: Awaited<ReturnType<typeof inspectDirectorKnowledgeLane>>,
) {
  if (!inspection.enabled) {
    return {
      status: "pass" as const,
      summary: "Director knowledge recall is intentionally disabled by switch.",
      details: {
        status: "disabled",
        hitCount: 0,
        maxHits: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
        maxChars: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
      },
    };
  }

  const latestPack = inspection.latestPublishedDocument;
  if (!latestPack) {
    return {
      status: "pass" as const,
      summary: "Director knowledge recall preview is idle because no published packs exist yet.",
      details: {
        status: "miss",
        hitCount: 0,
        maxHits: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
        maxChars: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
      },
    };
  }

  const preview = await inspectDirectorKnowledgeRecall(workspaceRoot, {
    projectId: latestPack.method.projectId,
    groupId: latestPack.method.groupId,
    anchorIds: latestPack.method.anchorIds,
    preferredAdapters: latestPack.method.preferredAdapters,
    tags: latestPack.metadata.tags ?? [],
    ...(latestPack.method.generationType === undefined
      ? {}
      : { generationType: latestPack.method.generationType }),
    ...(latestPack.method.generationStyle === undefined
      ? {}
      : { generationStyle: latestPack.method.generationStyle }),
    maxHits: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
    maxChars: DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
  });

  const packet = preview.packet;
  if (!packet) {
    return {
      status: "warn" as const,
      summary: "Director knowledge recall preview could not produce a packet.",
      details: {
        status: "degraded",
        hitCount: 0,
      },
    };
  }

  return {
    status: packet.status === "degraded" ? ("warn" as const) : ("pass" as const),
    summary:
      packet.status === "hit"
        ? "Director knowledge recall preview returned a hit."
        : "Director knowledge recall preview completed without blocking the operator lane.",
    details: {
      status: packet.status,
      hitCount: packet.hits.length,
      truncated: packet.truncated,
      maxHits: packet.query.maxHits,
      maxChars: packet.query.maxChars,
      ...(packet.hits[0] === undefined
        ? {}
        : {
            knowledgePackId: packet.hits[0].knowledgePackId,
            proposalId: packet.hits[0].provenance.sourceProposalId,
          }),
    },
  };
}

function buildDirectorMemoryIngestProbe(
  inspection: Awaited<ReturnType<typeof inspectDirectorMemoryLane>>,
) {
  if (!inspection.enabled) {
    return {
      status: "pass" as const,
      summary: "Terminal run -> memory ingest is intentionally inactive while memory is disabled.",
      details: {
        latestIngestStatus: "disabled",
      },
    };
  }

  if (!inspection.latestIngest) {
    return {
      status: "warn" as const,
      summary: "Director memory is enabled, but no ingest audit exists yet.",
      details: {
        latestIngestStatus: "none",
      },
    };
  }

  return {
    status: inspection.latestIngest.status === "degraded" ? ("warn" as const) : ("pass" as const),
    summary:
      inspection.latestIngest.status === "degraded"
        ? "Terminal run -> memory ingest closure is degraded."
        : "Terminal run -> memory ingest closure is healthy.",
    details: {
      latestIngestStatus: inspection.latestIngest.status,
      ...(inspection.latestIngest.recordId === undefined
        ? {}
        : { recordId: inspection.latestIngest.recordId }),
      ...(inspection.latestIngest.runId === undefined
        ? {}
        : { runId: inspection.latestIngest.runId }),
    },
  };
}

function updateSessionPreference(
  sessionStore: SessionStore,
  sessionId: string,
  input: {
    readonly key: "outputStyle" | "permissionMode" | "responseLanguage";
    readonly value: string;
    readonly eventType:
      | "control.output_style"
      | "control.permission_mode"
      | "control.response_language";
  },
) {
  const session = ensureSession(sessionStore, sessionId);
  const occurredAtMs = Date.now();
  const metadata = isRecord(session.metadata) ? { ...session.metadata } : {};
  const preferences = isRecord(metadata.preferences) ? { ...metadata.preferences } : {};
  const previousValue =
    typeof preferences[input.key] === "string" ? (preferences[input.key] as string) : undefined;

  const updated = sessionStore.updateMetadata(sessionId, {
    ...metadata,
    preferences: {
      ...preferences,
      [input.key]: input.value,
    },
  });

  const sessionGuidance = buildSessionGuidanceSummary(updated.metadata);

  sessionStore.appendJournal(sessionId, {
    eventType: input.eventType,
    payload: {
      ...(input.key === "outputStyle"
        ? {
            ...(previousValue === undefined ? {} : { previousStyle: previousValue }),
            style: input.value,
          }
        : input.key === "permissionMode"
          ? {
              ...(previousValue === undefined ? {} : { previousMode: previousValue }),
              mode: input.value,
            }
          : {
              ...(previousValue === undefined ? {} : { previousLanguage: previousValue }),
              language: input.value,
            }),
      ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    },
    createdAtMs: occurredAtMs,
  });

  return {
    sessionId: updated.sessionId,
    metadata: updated.metadata,
    ...(previousValue === undefined ? {} : { previousValue }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
  };
}

function buildSessionGuidanceSummary(metadata: unknown):
  | {
      readonly outputStyle?: string;
      readonly permissionMode?: string;
      readonly responseLanguage?: string;
    }
  | undefined {
  const metadataRecord = isRecord(metadata) ? metadata : {};
  const preferences = isRecord(metadataRecord.preferences) ? metadataRecord.preferences : {};
  const outputStyle =
    typeof preferences.outputStyle === "string" ? preferences.outputStyle : undefined;
  const permissionMode =
    typeof preferences.permissionMode === "string" ? preferences.permissionMode : undefined;
  const responseLanguage =
    typeof preferences.responseLanguage === "string" ? preferences.responseLanguage : undefined;

  if (outputStyle === undefined && permissionMode === undefined && responseLanguage === undefined) {
    return undefined;
  }

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

function buildRuntimeDefaultGuidanceSummary(config: HotflowConfig): PromptSessionGuidanceSummary {
  return {
    outputStyle: config.outputStyle,
    permissionMode: config.permissionMode,
    responseLanguage: config.responseLanguage,
  };
}

function hasSessionGuidanceOverride(
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
  field: keyof PromptSessionGuidanceSummary,
): boolean {
  return (
    sessionGuidance !== undefined &&
    Object.prototype.hasOwnProperty.call(sessionGuidance, field) &&
    typeof sessionGuidance[field] === "string"
  );
}

function buildEffectiveGuidanceSourceSummary(
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSourceSummary {
  return {
    outputStyle: hasSessionGuidanceOverride(sessionGuidance, "outputStyle")
      ? "session-override"
      : "runtime-default",
    permissionMode: hasSessionGuidanceOverride(sessionGuidance, "permissionMode")
      ? "session-override"
      : "runtime-default",
    responseLanguage: hasSessionGuidanceOverride(sessionGuidance, "responseLanguage")
      ? "session-override"
      : "runtime-default",
  };
}

function resolveEffectiveGuidanceSummary(
  config: HotflowConfig,
  effectiveGuidance: PromptSessionGuidanceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSummary {
  return {
    ...buildRuntimeDefaultGuidanceSummary(config),
    ...(sessionGuidance === undefined ? {} : sessionGuidance),
    ...(effectiveGuidance === undefined ? {} : effectiveGuidance),
  };
}

function resolveEffectiveGuidanceSourceSummary(
  effectiveGuidanceSources: PromptSessionGuidanceSourceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSourceSummary {
  return {
    ...buildEffectiveGuidanceSourceSummary(sessionGuidance),
    ...(effectiveGuidanceSources === undefined ? {} : effectiveGuidanceSources),
  };
}

function buildEffectiveGuidanceSummary(
  config: HotflowConfig,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSummary {
  return {
    ...buildRuntimeDefaultGuidanceSummary(config),
    ...(sessionGuidance === undefined ? {} : sessionGuidance),
  };
}

function attachEffectiveGuidanceToStatusSnapshot(
  config: HotflowConfig,
  snapshot: ReturnType<typeof createSessionObservationSnapshot>,
) {
  const sessionGuidance = snapshot.sessionGuidance ?? snapshot.step?.promptSummary?.sessionGuidance;
  const effectiveGuidance = buildEffectiveGuidanceSummary(config, sessionGuidance);
  const effectiveGuidanceSources = buildEffectiveGuidanceSourceSummary(sessionGuidance);
  const promptSummaryEffectiveGuidance =
    snapshot.step?.promptSummary === undefined
      ? undefined
      : resolveEffectiveGuidanceSummary(
          config,
          snapshot.step.promptSummary.effectiveGuidance,
          snapshot.step.promptSummary.sessionGuidance ?? sessionGuidance,
        );
  const promptSummaryEffectiveGuidanceSources =
    snapshot.step?.promptSummary === undefined
      ? undefined
      : resolveEffectiveGuidanceSourceSummary(
          snapshot.step.promptSummary.effectiveGuidanceSources,
          snapshot.step.promptSummary.sessionGuidance ?? sessionGuidance,
        );

  return {
    ...snapshot,
    effectiveGuidance,
    effectiveGuidanceSources,
    ...(snapshot.step?.promptSummary === undefined
      ? {}
      : {
          step: {
            ...snapshot.step,
            promptSummary: {
              ...snapshot.step.promptSummary,
              ...(promptSummaryEffectiveGuidance === undefined
                ? {}
                : { effectiveGuidance: promptSummaryEffectiveGuidance }),
              ...(promptSummaryEffectiveGuidanceSources === undefined
                ? {}
                : { effectiveGuidanceSources: promptSummaryEffectiveGuidanceSources }),
            },
          },
        }),
  };
}

function attachEffectiveGuidanceToPromptExplainSnapshot(
  config: HotflowConfig,
  snapshot: ReturnType<typeof createSessionPromptExplainSnapshot>,
) {
  return {
    ...snapshot,
    effectiveGuidance: resolveEffectiveGuidanceSummary(
      config,
      snapshot.effectiveGuidance,
      snapshot.sessionGuidance,
    ),
    effectiveGuidanceSources: resolveEffectiveGuidanceSourceSummary(
      snapshot.effectiveGuidanceSources,
      snapshot.sessionGuidance,
    ),
  };
}

function attachEffectiveGuidanceToPromptInspectSnapshot(
  config: HotflowConfig,
  snapshot: ReturnType<typeof createSessionPromptInspectSnapshot>,
) {
  return {
    ...snapshot,
    effectiveGuidance: resolveEffectiveGuidanceSummary(
      config,
      snapshot.effectiveGuidance,
      snapshot.sessionGuidance,
    ),
    effectiveGuidanceSources: resolveEffectiveGuidanceSourceSummary(
      snapshot.effectiveGuidanceSources,
      snapshot.sessionGuidance,
    ),
  };
}

function attachEffectiveGuidanceToControlPreferenceResult<
  T extends {
    readonly sessionGuidance?: PromptSessionGuidanceSummary;
  },
>(config: HotflowConfig, result: T) {
  return {
    ...result,
    effectiveGuidance: buildEffectiveGuidanceSummary(config, result.sessionGuidance),
    effectiveGuidanceSources: buildEffectiveGuidanceSourceSummary(result.sessionGuidance),
  };
}

function inspectSessionMemory(
  memory: MemoryCoreManager,
  sessionId: string,
  scope: "working" | "episodic" | "all",
): CliSessionMemoryInspectionResult {
  const layer0 = memory.layer0.listByScope({ sessionId });
  const layer1 = memory.layer1.listByScope({ sessionId });

  if (scope === "working") {
    return {
      sessionId,
      scope,
      layer0Count: layer0.length,
      layer0Ids: layer0.map((entry) => entry.id),
      layer1Ids: [],
    };
  }

  if (scope === "episodic") {
    return {
      sessionId,
      scope,
      layer1Count: layer1.length,
      layer0Ids: [],
      layer1Ids: layer1.map((entry) => entry.id),
    };
  }

  return {
    sessionId,
    scope,
    layer0Count: layer0.length,
    layer1Count: layer1.length,
    layer0Ids: layer0.map((entry) => entry.id),
    layer1Ids: layer1.map((entry) => entry.id),
  };
}

function clearSessionMemory(
  memory: MemoryCoreManager,
  sessionId: string,
  scope: "working" | "episodic" | "all",
): CliSessionMemoryClearResult {
  const beforeLayer0Entries = memory.layer0.listByScope({ sessionId });
  const beforeLayer1Entries = memory.layer1.listByScope({ sessionId });
  const layer0Entries = scope === "episodic" ? [] : beforeLayer0Entries;
  const layer1Entries = scope === "working" ? [] : beforeLayer1Entries;

  for (const entry of layer0Entries) {
    memory.layer0.remove(entry.id);
  }
  for (const entry of layer1Entries) {
    memory.layer1.remove(entry.id);
  }

  return {
    sessionId,
    scope,
    beforeLayer0Count: beforeLayer0Entries.length,
    beforeLayer1Count: beforeLayer1Entries.length,
    layer0Cleared: layer0Entries.length,
    layer1Cleared: layer1Entries.length,
    afterLayer0Count: memory.layer0.listByScope({ sessionId }).length,
    afterLayer1Count: memory.layer1.listByScope({ sessionId }).length,
    layer0Ids: layer0Entries.map((entry) => entry.id),
    layer1Ids: layer1Entries.map((entry) => entry.id),
  };
}

function summarizeSessionMemoryStatus(
  memory: MemoryCoreManager,
  sessionId: string,
): CliSessionMemoryStatusSummary {
  return {
    workingMemoryEntries: memory.layer0.listByScope({ sessionId }).length,
    episodicMemoryEntries: memory.layer1.listByScope({ sessionId }).length,
  };
}

function compactSessionContext(
  sessionStore: SessionStore,
  memory: MemoryCoreManager,
  sessionId: string,
  strategy: "soft" | "hard",
): CliSessionCompactionResult {
  ensureSession(sessionStore, sessionId);
  const beforeLayer0 = memory.layer0.listByScope({ sessionId });
  const beforeLayer1 = memory.layer1.listByScope({ sessionId });
  const beforeEntries = [...beforeLayer0, ...beforeLayer1];
  const beforeTokens = estimateMemoryEntryTokens(beforeEntries);
  const beforeEntryCount = beforeEntries.length;
  const occurredAtMs = Date.now();

  let removedEntryIds: string[] = [];
  let summaryEntryIds: string[] = [];
  let reason: string | undefined;

  if (strategy === "soft") {
    if (beforeLayer0.length < 3) {
      reason = "soft-compaction-requires-at-least-3-working-memory-entries";
    } else {
      const compactedEntries = beforeLayer0.slice(1);
      const sourceEntries = compactedEntries.filter((entry) =>
        isCompactionSourceEntryAllowed(entry, "layer0"),
      );
      const summaryEntry = createCompactionSummaryEntry(memory, {
        layer: "layer0",
        sessionId,
        strategy,
        sourceEntries,
        occurredAtMs,
      });

      if (summaryEntry === undefined) {
        reason = "working-memory-already-compact";
      } else {
        removedEntryIds = compactedEntries.map((entry) => entry.id);
        summaryEntryIds = [summaryEntry.id];
        for (const entry of compactedEntries) {
          memory.layer0.remove(entry.id);
        }
      }
    }
  } else {
    const sourceEntries = [...beforeLayer0, ...beforeLayer1].filter((entry) =>
      isCompactionSourceEntryAllowed(entry, "layer1"),
    );
    if (beforeLayer0.length + beforeLayer1.length < 2) {
      reason = "hard-compaction-requires-at-least-2-memory-entries";
    } else if (sourceEntries.length === 0) {
      reason = "hard-compaction-has-no-admissible-memory-entries";
    } else {
      const summaryEntry = createCompactionSummaryEntry(memory, {
        layer: "layer1",
        sessionId,
        strategy,
        sourceEntries,
        occurredAtMs,
      });

      if (summaryEntry === undefined) {
        reason = "session-memory-already-compact";
      } else {
        removedEntryIds = [...beforeLayer0, ...beforeLayer1].map((entry) => entry.id);
        summaryEntryIds = [summaryEntry.id];
        for (const entry of beforeLayer0) {
          memory.layer0.remove(entry.id);
        }
        for (const entry of beforeLayer1) {
          memory.layer1.remove(entry.id);
        }
      }
    }
  }

  const afterEntries = [
    ...memory.layer0.listByScope({ sessionId }),
    ...memory.layer1.listByScope({ sessionId }),
  ];
  const afterTokens = estimateMemoryEntryTokens(afterEntries);
  const result: CliSessionCompactionResult = {
    sessionId,
    compacted: removedEntryIds.length > 0,
    strategy,
    beforeTokens,
    afterTokens,
    reducedTokens: Math.max(0, beforeTokens - afterTokens),
    beforeEntryCount,
    afterEntryCount: afterEntries.length,
    removedEntryIds,
    summaryEntryIds,
    ...(reason === undefined ? {} : { reason }),
  };

  sessionStore.appendJournal(sessionId, {
    eventType: "control.compact",
    payload: {
      strategy,
      compacted: result.compacted,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      reducedTokens: result.reducedTokens,
      beforeEntryCount: result.beforeEntryCount,
      afterEntryCount: result.afterEntryCount,
      removedEntryIds,
      summaryEntryIds,
      ...(reason === undefined ? {} : { reason }),
    },
    createdAtMs: occurredAtMs,
  });

  return result;
}

function createCompactionSummaryEntry(
  memory: MemoryCoreManager,
  input: {
    readonly layer: "layer0" | "layer1";
    readonly sessionId: string;
    readonly strategy: "soft" | "hard";
    readonly sourceEntries: readonly MemoryEntry[];
    readonly occurredAtMs: number;
  },
): MemoryEntry | undefined {
  if (input.sourceEntries.length === 0) {
    return undefined;
  }

  const sourceTokens = estimateMemoryEntryTokens(input.sourceEntries);
  const content = buildCompactionSummaryContent(input.strategy, input.sourceEntries);
  if (estimateTokens(content) >= sourceTokens) {
    return undefined;
  }

  const sourceAdmissionSummaries = input.sourceEntries.map((entry) =>
    summarizeCompactionSourceAdmission(entry),
  );
  const sourceSafetyFindings = sourceAdmissionSummaries.flatMap(
    (summary) => summary.safetyFindings,
  );
  const tags = Array.from(
    new Set([
      "control-plane",
      "compacted",
      input.strategy,
      "memory:compaction",
      "memory:system-summary",
      ...input.sourceEntries.flatMap((entry) => entry.tags).filter(isSafeCompactionSummaryTag),
    ]),
  ).slice(0, 12);
  const metadata = {
    strategy: input.strategy,
    compactedAtMs: input.occurredAtMs,
    sourceEntryIds: input.sourceEntries.map((entry) => entry.id),
    sourceLayers: Array.from(new Set(input.sourceEntries.map((entry) => entry.layer))),
    sourceNamespaces: Array.from(
      new Set(input.sourceEntries.map((entry) => entry.scope.namespace ?? "(default)")),
    ),
    sourceAdmissions: sourceAdmissionSummaries.map((summary) => ({
      entryId: summary.entryId,
      retention: summary.retention,
      category: summary.category,
      safe: summary.safe,
    })),
    memoryAdmission: {
      category: "conversation",
      retention: input.layer === "layer1" ? "user" : "working",
      confidence: 0.74,
      score: 0.74,
      reason:
        input.strategy === "hard"
          ? "system:hard-compaction-summary"
          : "system:soft-compaction-summary",
      safety: {
        safe: sourceSafetyFindings.length === 0,
        findings: sourceSafetyFindings,
      },
    },
  };

  if (input.layer === "layer0") {
    return memory.writeLayer0({
      content,
      scope: { sessionId: input.sessionId, namespace: "compaction" },
      tags,
      metadata,
      timestamp: input.occurredAtMs,
    });
  }

  return memory.writeLayer1({
    content,
    scope: { sessionId: input.sessionId, namespace: "compaction" },
    tags,
    metadata,
    timestamp: input.occurredAtMs,
  });
}

function isCompactionSourceEntryAllowed(
  entry: MemoryEntry,
  targetLayer: "layer0" | "layer1",
): boolean {
  const namespace = entry.scope.namespace?.toLowerCase();
  if (namespace === "assistant-output") {
    return false;
  }

  const normalizedTags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
  if (
    normalizedTags.has("memory:noise") ||
    normalizedTags.has("memory:quarantine") ||
    normalizedTags.has("memory:casual") ||
    normalizedTags.has("memory:assistant-output")
  ) {
    return false;
  }

  const admission = readMemoryAdmission(entry);
  if (admission === undefined) {
    return false;
  }

  const retention = readStringField(admission, "retention");
  if (retention === "none" || retention === "quarantine") {
    return false;
  }

  if (targetLayer === "layer1") {
    return retention === "user";
  }

  return retention === "working" || retention === "user";
}

function isSafeCompactionSummaryTag(tag: string): boolean {
  const normalized = tag.toLowerCase();
  return (
    normalized !== "memory:noise" &&
    normalized !== "memory:quarantine" &&
    normalized !== "memory:casual" &&
    normalized !== "memory:assistant-output"
  );
}

function summarizeCompactionSourceAdmission(entry: MemoryEntry): {
  readonly entryId: string;
  readonly retention?: string;
  readonly category?: string;
  readonly safe: boolean;
  readonly safetyFindings: readonly unknown[];
} {
  const admission = readMemoryAdmission(entry);
  const safety = readObjectField(admission, "safety");
  const findings = Array.isArray(safety?.findings) ? safety.findings : [];
  const safe = safety === undefined ? true : safety.safe !== false && findings.length === 0;
  const retention = readStringField(admission, "retention");
  const category = readStringField(admission, "category");

  return {
    entryId: entry.id,
    ...(retention === undefined ? {} : { retention }),
    ...(category === undefined ? {} : { category }),
    safe,
    safetyFindings: findings,
  };
}

function readMemoryAdmission(entry: MemoryEntry): Record<string, unknown> | undefined {
  return readObjectField(entry.metadata, "memoryAdmission");
}

function readObjectField(
  value: Record<string, unknown> | undefined,
  field: string,
): Record<string, unknown> | undefined {
  const fieldValue = value?.[field];
  if (typeof fieldValue !== "object" || fieldValue === null || Array.isArray(fieldValue)) {
    return undefined;
  }

  return fieldValue as Record<string, unknown>;
}

function readStringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const fieldValue = value?.[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function buildCompactionSummaryContent(
  strategy: "soft" | "hard",
  sourceEntries: readonly MemoryEntry[],
): string {
  const sourceTokens = estimateMemoryEntryTokens(sourceEntries);
  const maxItems = strategy === "soft" ? 4 : 3;
  const snippetChars = strategy === "soft" ? 96 : 72;
  const lines = [
    strategy === "soft"
      ? "Soft compaction summary for older working-memory entries."
      : "Hard compaction summary for the session memory set.",
    `Merged entries: ${sourceEntries.length}`,
    `Layers: ${Array.from(new Set(sourceEntries.map((entry) => entry.layer))).join(", ")}`,
    ...sourceEntries.slice(0, maxItems).map((entry, index) => {
      const namespace = entry.scope.namespace ?? "default";
      return `${index + 1}. [${entry.layer}/${namespace}] ${toCompactionSnippet(entry.content, snippetChars)}`;
    }),
    ...(sourceEntries.length > maxItems
      ? [`+${sourceEntries.length - maxItems} more entries merged into this summary.`]
      : []),
  ];

  const verboseSummary = lines.join("\n");
  if (estimateTokens(verboseSummary) < sourceTokens) {
    return verboseSummary;
  }

  const compactSummary = [
    strategy === "soft"
      ? "Soft compaction summary for session working memory."
      : "Hard compaction summary for the full session memory.",
    `Merged entries: ${sourceEntries.length}`,
    `Layers: ${Array.from(new Set(sourceEntries.map((entry) => entry.layer))).join(", ")}`,
    `Namespaces: ${Array.from(
      new Set(sourceEntries.map((entry) => entry.scope.namespace ?? "default")),
    ).join(", ")}`,
  ].join("\n");

  if (estimateTokens(compactSummary) < sourceTokens) {
    return compactSummary;
  }

  return [
    strategy === "soft" ? "Soft compacted memory summary." : "Hard compacted memory summary.",
    `Merged entries: ${sourceEntries.length}`,
  ].join("\n");
}

function toCompactionSnippet(content: string, maxChars: number): string {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function estimateMemoryEntryTokens(entries: readonly MemoryEntry[]): number {
  return entries.reduce((total, entry) => total + estimateTokens(entry.content), 0);
}

function ensureSession(sessionStore: SessionStore, sessionId: string) {
  return sessionStore.getSession(sessionId) ?? sessionStore.createSession({ sessionId });
}

function requireExistingSession(sessionStore: SessionStore, sessionId: string) {
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
}

function createTaskPlane(
  sessionStore: SessionStore,
  sessionId: string,
  options?: ConstructorParameters<typeof SessionStoreTaskPlanePort>[2],
): SessionStoreTaskPlanePort {
  return new SessionStoreTaskPlanePort(sessionStore, sessionId, options);
}

function toCliProposalListEntry(proposal: ProposalRecord): Record<string, unknown> {
  const decoded = decodeSkillProposal(proposal);
  return {
    id: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    provenance: proposal.provenance,
    ...(decoded?.riskLevel === undefined ? {} : { riskLevel: decoded.riskLevel }),
    ...(decoded?.confidence === undefined ? {} : { confidence: decoded.confidence }),
  };
}

function reviewCliProposal(
  proposal: ProposalRecord,
  reviewer: SkillProposalReviewer,
): Record<string, unknown> {
  const review = reviewer.reviewProposal(proposal);
  const summary = {
    fatal: 0,
    risky: 0,
    warning: 0,
    info: 0,
  };

  for (const issue of review.issues) {
    summary[issue.severity] += 1;
  }

  return {
    proposalId: review.proposalId,
    verdict: review.verdict,
    decisionNote: review.decisionNote,
    summary,
    issues: review.issues.map((issue) => ({
      code: issue.code,
      field: issue.field,
      message: issue.message,
      severity: issue.severity,
    })),
  };
}

function explainCliProposal(proposal: ProposalRecord): Record<string, unknown> {
  const decoded = decodeSkillProposal(proposal);
  return {
    proposalId: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    provenance: proposal.provenance,
    ...(decoded?.trajectoryRef === undefined ? {} : { trajectoryRef: decoded.trajectoryRef }),
    ...(decoded?.trigger === undefined ? {} : { trigger: decoded.trigger }),
    ...(decoded?.evidenceSummary === undefined ? {} : { evidenceSummary: decoded.evidenceSummary }),
    ...(decoded?.riskLevel === undefined ? {} : { riskLevel: decoded.riskLevel }),
    ...(decoded?.confidence === undefined ? {} : { confidence: decoded.confidence }),
    ...(decoded?.dedupeKey === undefined ? {} : { dedupeKey: decoded.dedupeKey }),
    ...(decoded?.explanation === undefined ? {} : { explanation: decoded.explanation }),
  };
}

function assertSkillProposal(proposal: ProposalRecord): void {
  if (proposal.kind !== SKILL_SNAPSHOT_UPSERT_KIND) {
    throw new Error(`Proposal kind does not support safe apply preview: ${proposal.kind}`);
  }
}

function recordControlActionAudit(
  telemetry: CliTelemetry,
  action: ControlPlaneAction,
  result: ControlPlaneResult,
): void {
  telemetry.recordAuditEvent({
    sessionId: action.sessionId,
    kind: "control.action",
    payload: {
      action: action.type,
      ok: result.ok,
      ...(result.error === undefined ? {} : { error: result.error }),
    },
  });
}

function recordSkillProposalApplyAudit(
  telemetry: CliTelemetry,
  input: {
    readonly sessionId: string;
    readonly snapshotPath: string;
    readonly proposalId: string;
    readonly skillId: string;
    readonly operation: "create" | "update";
    readonly changedFields: readonly { readonly field: string }[];
    readonly snapshotVersion: number;
    readonly previousSnapshotVersion: number | null;
    readonly appliedAtMs: number;
    readonly appliedFromProposalId: string | null;
    readonly approvedSkillCount: number;
  },
): void {
  telemetry.recordAuditEvent({
    sessionId: input.sessionId,
    kind: "skills.proposal_apply",
    payload: {
      proposalId: input.proposalId,
      skillId: input.skillId,
      operation: input.operation,
      changedFields: input.changedFields.map((entry) => entry.field),
      snapshotVersion: input.snapshotVersion,
      previousSnapshotVersion: input.previousSnapshotVersion,
      approvedSkillCount: input.approvedSkillCount,
    },
    occurredAtMs: input.appliedAtMs,
  });
  telemetry.recordAuditEvent({
    sessionId: input.sessionId,
    kind: "skills.snapshot_write",
    payload: {
      reason: "proposal-apply",
      snapshotPath: input.snapshotPath,
      snapshotVersion: input.snapshotVersion,
      previousSnapshotVersion: input.previousSnapshotVersion,
      appliedFromProposalId: input.appliedFromProposalId,
      approvedSkillCount: input.approvedSkillCount,
    },
    occurredAtMs: input.appliedAtMs,
  });
}

function recordSkillRollbackAudit(
  telemetry: CliTelemetry,
  input: {
    readonly sessionId: string;
    readonly snapshotPath: string;
    readonly currentVersionBefore: number;
    readonly restoredFromVersion: number;
    readonly currentVersionAfter: number;
    readonly previousSnapshotVersion: number | null;
    readonly approvedSkillCount: number;
    readonly restoredSkillIds: readonly string[];
  },
): void {
  const occurredAtMs = Date.now();
  telemetry.recordAuditEvent({
    sessionId: input.sessionId,
    kind: "skills.rollback",
    payload: {
      currentVersionBefore: input.currentVersionBefore,
      restoredFromVersion: input.restoredFromVersion,
      currentVersionAfter: input.currentVersionAfter,
      restoredSkillIds: [...input.restoredSkillIds],
    },
    occurredAtMs,
  });
  telemetry.recordAuditEvent({
    sessionId: input.sessionId,
    kind: "skills.snapshot_write",
    payload: {
      reason: "rollback",
      snapshotPath: input.snapshotPath,
      snapshotVersion: input.currentVersionAfter,
      previousSnapshotVersion: input.previousSnapshotVersion,
      restoredFromVersion: input.restoredFromVersion,
      approvedSkillCount: input.approvedSkillCount,
    },
    occurredAtMs,
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveCliSessionDbPathForOperator(
  config: { dataDir: string; sessionDbPath: string },
  env: NodeJS.ProcessEnv,
): string {
  const override = env.HOTFLOW_CLI_SESSION_DB_PATH?.trim();
  if (override) {
    return override;
  }
  return `${config.dataDir}/sessions/cli.sqlite`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
