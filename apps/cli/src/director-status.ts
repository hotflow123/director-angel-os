import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  type ExecutionRunReport,
  isExecutionRun,
  isExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import { FileSystemDirectorProposalStore } from "@hotflow/director-proposals";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

import { describeDirectorBridgeFailureNextAction } from "./director-bridge-failure-guidance.js";
import {
  type KnowledgeEvolutionSwitchState,
  inspectDirectorKnowledgeLane,
} from "./director-knowledge.js";
import { inspectDirectorMemoryLane } from "./director-memory.js";
import {
  type DirectorRouteHealthEntry,
  deriveDirectorRouteHealthEntries,
} from "./director-route-health.js";
import { deriveDirectorRunHoldingStateSurface } from "./director-run-holding-state.js";

export interface DirectorStatusSummary {
  readonly workspaceRoot: string;
  readonly knowledgeDir: string;
  readonly publishedCount: number;
  readonly reviewQueueCount: number;
  readonly rollbackCount: number;
  readonly hasCandidate: boolean;
  readonly knowledgeRecallEnabled: boolean;
  readonly latestPublishedAt: string | null;
  readonly latestRollbackAt: string | null;
  readonly latestRollbackVersion: number | null;
  readonly knowledgeEvolution: KnowledgeEvolutionSwitchState;
  readonly observationLogPath: string;
  readonly observationRecordCount: number;
  readonly proposalLaneStatus: "ok" | "degraded";
  readonly proposalCount: number;
  readonly memoryEnabled: boolean;
  readonly memoryStoreStatus: "ok" | "degraded" | "disabled";
  readonly memoryRecordCount: number;
  readonly latestMemoryIngestStatus?: "ok" | "degraded" | "disabled";
  readonly executionRunCount: number;
  readonly executionReportCount: number;
  readonly unreadableExecutionArtifacts: number;
  readonly latestRun?: DirectorExecutionRunSummary;
  readonly latestReport?: DirectorExecutionReportSummary;
}

export interface DirectorExecutionRunSummary {
  readonly runId: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly goal: string;
  readonly previewSummary: string;
}

export interface DirectorExecutionReportSummary {
  readonly runId: string;
  readonly reportId: string;
  readonly recordedAt: string;
  readonly runStatus: string;
  readonly hasOperatorSurface: boolean;
  readonly directorGoal: string;
  readonly operatorSummary?: string;
  readonly objective?: string;
  readonly deliverable?: string;
  readonly adapterRoute?: string;
  readonly lastBridgeRoute?: string;
  readonly bridgeVerdict?: "accepted" | "responded" | "failed";
  readonly bridgeFailureReason?: string;
  readonly retryable?: boolean;
  readonly retryAllowed?: boolean;
  readonly rerouteCandidates?: readonly string[];
  readonly holdingState?: string;
  readonly holdingSummary?: string;
  readonly suggestedCommands?: readonly string[];
  readonly nextAction?: string;
  readonly routeHealth?: readonly DirectorExecutionRouteHealthSummary[];
}

export interface DirectorExecutionRouteHealthSummary extends DirectorRouteHealthEntry {}

export async function inspectDirectorStatus(workspaceRoot: string): Promise<DirectorStatusSummary> {
  const paths = resolveDirectorWorkspace({ root: workspaceRoot });
  const [knowledge, memory, execution] = await Promise.all([
    inspectDirectorKnowledgeLane(workspaceRoot),
    inspectDirectorMemoryLane(workspaceRoot),
    inspectDirectorExecutionLane(paths.runtime),
  ]);
  const proposalStatus = await inspectDirectorProposalLane(paths.runtime);
  const observationLogPath = resolve(paths.runtime, "observations.ndjson");
  const observationRecordCount = await countObservationRecords(observationLogPath);

  return {
    workspaceRoot,
    knowledgeDir: paths.knowledge,
    publishedCount: knowledge.publishedCount,
    reviewQueueCount: knowledge.reviewQueueCount,
    rollbackCount: knowledge.rollbackCount,
    hasCandidate: knowledge.hasCandidate,
    knowledgeRecallEnabled: knowledge.enabled,
    latestPublishedAt: knowledge.latestPublishedDocument?.audit.publishedAt ?? null,
    latestRollbackAt: knowledge.latestRollbackRecord?.rolledBackAt ?? null,
    latestRollbackVersion: knowledge.latestRollbackRecord?.currentVersionAfter ?? null,
    knowledgeEvolution: knowledge.knowledgeEvolution,
    observationLogPath,
    observationRecordCount,
    proposalLaneStatus: proposalStatus.status,
    proposalCount: proposalStatus.proposalCount,
    memoryEnabled: memory.enabled,
    memoryStoreStatus: memory.storeStatus,
    memoryRecordCount: memory.recordCount,
    ...(memory.latestIngest === undefined
      ? {}
      : { latestMemoryIngestStatus: memory.latestIngest.status }),
    executionRunCount: execution.runCount,
    executionReportCount: execution.reportCount,
    unreadableExecutionArtifacts: execution.unreadableArtifacts,
    ...(execution.latestRun === undefined ? {} : { latestRun: execution.latestRun }),
    ...(execution.latestReport === undefined ? {} : { latestReport: execution.latestReport }),
  };
}

export async function describeDirectorStatus(workspaceRoot: string): Promise<string> {
  const summary = await inspectDirectorStatus(workspaceRoot);

  const lines = [
    "Director status:",
    `  workspace root: ${summary.workspaceRoot}`,
    `  knowledge dir: ${summary.knowledgeDir}`,
    `  published packs: ${summary.publishedCount}`,
    `  review queue: ${summary.reviewQueueCount}`,
    `  rollback artifacts: ${summary.rollbackCount}`,
    `  candidate ready: ${summary.hasCandidate ? "yes" : "no"}`,
    `  knowledge recall enabled: ${summary.knowledgeRecallEnabled ? "yes" : "no"}`,
    `  latest published at: ${summary.latestPublishedAt ?? "(none)"}`,
    `  latest rollback at: ${summary.latestRollbackAt ?? "(none)"}`,
    `  latest rollback version: ${summary.latestRollbackVersion ?? "(none)"}`,
    `  knowledge evolution switches: ${formatKnowledgeEvolutionSwitches(summary.knowledgeEvolution)}`,
    `  observation log: ${summary.observationLogPath}`,
    `  observation records: ${summary.observationRecordCount}`,
    `  memory enabled: ${summary.memoryEnabled ? "yes" : "no"}`,
    `  memory records: ${summary.memoryRecordCount}`,
    `  memory store: ${summary.memoryStoreStatus}`,
    `  latest memory ingest: ${summary.latestMemoryIngestStatus ?? "(none)"}`,
    `  proposal lane: ${summary.proposalLaneStatus}`,
    `  trace proposals: ${summary.proposalCount}`,
    `  execution runs: ${summary.executionRunCount}`,
    `  execution reports: ${summary.executionReportCount}`,
    `  unreadable execution artifacts: ${summary.unreadableExecutionArtifacts}`,
  ];

  if (summary.latestRun) {
    lines.push(
      `  latest run: ${summary.latestRun.runId} status=${summary.latestRun.status} updated=${summary.latestRun.updatedAt}`,
    );
  }

  if (summary.latestReport) {
    lines.push(
      `  latest report: ${summary.latestReport.reportId} status=${summary.latestReport.runStatus} recorded=${summary.latestReport.recordedAt}`,
    );
    if (summary.latestReport.bridgeVerdict !== undefined) {
      lines.push(
        summary.latestReport.bridgeVerdict === "failed" &&
          summary.latestReport.bridgeFailureReason !== undefined
          ? `  latest bridge verdict: failed (${summary.latestReport.bridgeFailureReason})`
          : `  latest bridge verdict: ${summary.latestReport.bridgeVerdict}`,
      );
    }
    if (summary.latestReport.retryAllowed !== undefined) {
      lines.push(`  latest retry allowed: ${summary.latestReport.retryAllowed ? "yes" : "no"}`);
    }
    if (summary.latestReport.rerouteCandidates !== undefined) {
      lines.push(
        `  latest reroute candidates: ${summary.latestReport.rerouteCandidates.join(", ") || "(none)"}`,
      );
    }
    if (summary.latestReport.holdingState !== undefined) {
      lines.push(`  latest holding state: ${summary.latestReport.holdingState}`);
    }
    if (summary.latestReport.holdingSummary !== undefined) {
      lines.push(`  latest holding summary: ${summary.latestReport.holdingSummary}`);
    }
    if (summary.latestReport.nextAction !== undefined) {
      lines.push(`  latest next action: ${summary.latestReport.nextAction}`);
    }
    if (
      summary.latestReport.suggestedCommands !== undefined &&
      summary.latestReport.suggestedCommands.length > 0
    ) {
      lines.push(
        `  latest suggested commands: ${summary.latestReport.suggestedCommands.join(" | ")}`,
      );
    }
    if (
      summary.latestReport.routeHealth !== undefined &&
      summary.latestReport.routeHealth.length > 0
    ) {
      lines.push("  latest route health:");
      for (const entry of summary.latestReport.routeHealth) {
        const fragments = [
          `${entry.assignmentId}`,
          `role=${entry.role}`,
          `status=${entry.status}`,
          ...(entry.currentRoute === undefined ? [] : [`route=${entry.currentRoute}`]),
          ...(entry.lastBridgeRoute === undefined ? [] : [`last-bridge=${entry.lastBridgeRoute}`]),
          ...(entry.bridgeVerdict === undefined
            ? []
            : entry.bridgeVerdict === "failed"
              ? [
                  `bridge=failed${entry.bridgeFailureReason === undefined ? "" : `(${entry.bridgeFailureReason})`}`,
                ]
              : [`bridge=${entry.bridgeVerdict}`]),
          ...(entry.bridgeStatus === undefined ? [] : [`status=${entry.bridgeStatus}`]),
          ...(entry.retryAllowed === undefined
            ? []
            : [`retry-allowed=${entry.retryAllowed ? "yes" : "no"}`]),
        ];
        lines.push(`    - ${fragments.join(" ")}`);
        if (entry.rerouteCandidates.length > 0) {
          lines.push(`      reroute candidates: ${entry.rerouteCandidates.join(", ")}`);
        }
        if (entry.blockingReason !== undefined) {
          lines.push(`      blocking reason: ${entry.blockingReason}`);
        }
      }
    }
  }

  return lines.join("\n");
}

async function inspectDirectorProposalLane(runtimePath: string) {
  const store = new FileSystemDirectorProposalStore({
    rootPath: join(runtimePath, "proposals"),
  });
  return store.getStatus();
}

async function countObservationRecords(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length;
  } catch {
    return 0;
  }
}

function formatKnowledgeEvolutionSwitches(state: KnowledgeEvolutionSwitchState): string {
  return `enabled=${state.enabled ? "yes" : "no"} autoCandidate=${state.autoCandidate ? "yes" : "no"} publish=${state.publish ? "yes" : "no"}`;
}

async function inspectDirectorExecutionLane(runtimePath: string): Promise<{
  readonly runCount: number;
  readonly reportCount: number;
  readonly unreadableArtifacts: number;
  readonly latestRun?: DirectorExecutionRunSummary;
  readonly latestReport?: DirectorExecutionReportSummary;
}> {
  const runRoot = join(runtimePath, "execution", "runs");

  try {
    const entries = await readdir(runRoot, { withFileTypes: true });
    const runs: DirectorExecutionRunSummary[] = [];
    const reports: DirectorExecutionReportSummary[] = [];
    let unreadableArtifacts = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const [runResult, reportResult] = await Promise.all([
        readValidatedExecutionArtifact(join(runRoot, entry.name, "run.json"), isExecutionRun),
        readValidatedExecutionArtifact(
          join(runRoot, entry.name, "report.json"),
          isExecutionRunReport,
        ),
      ]);

      if (runResult.unreadable) {
        unreadableArtifacts += 1;
      } else if (runResult.value) {
        runs.push({
          runId: runResult.value.runId,
          status: runResult.value.status,
          updatedAt: runResult.value.updatedAt,
          goal: runResult.value.goal,
          previewSummary: runResult.value.previewSummary,
        });
      }

      if (reportResult.unreadable) {
        unreadableArtifacts += 1;
      } else if (reportResult.value) {
        reports.push(summarizeExecutionReport(reportResult.value));
      }
    }

    runs.sort((left, right) => compareIso(right.updatedAt, left.updatedAt));
    reports.sort((left, right) => compareIso(right.recordedAt, left.recordedAt));

    return {
      runCount: runs.length,
      reportCount: reports.length,
      unreadableArtifacts,
      ...(runs[0] === undefined ? {} : { latestRun: runs[0] }),
      ...(reports[0] === undefined ? {} : { latestReport: reports[0] }),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        runCount: 0,
        reportCount: 0,
        unreadableArtifacts: 0,
      };
    }

    return {
      runCount: 0,
      reportCount: 0,
      unreadableArtifacts: 1,
    };
  }
}

async function readValidatedExecutionArtifact<T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<{ readonly value: T | null; readonly unreadable: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!guard(parsed)) {
      return { value: null, unreadable: true };
    }
    return { value: parsed, unreadable: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: null, unreadable: false };
    }
    return { value: null, unreadable: true };
  }
}

function summarizeExecutionReport(report: ExecutionRunReport): DirectorExecutionReportSummary {
  const operatorSurface = report.operatorSurface;
  const holdingStateSurface = deriveDirectorRunHoldingStateSurface(report);
  const routeHealth = deriveDirectorRouteHealthEntries(report.run.assignments);
  const primaryAssignment =
    report.run.assignments.find((assignment) => assignment.result?.bridgeExecution !== undefined) ??
    report.run.assignments.find((assignment) => assignment.actionClass === "generate") ??
    report.run.assignments[0];
  const bridgeExecution = primaryAssignment?.result?.bridgeExecution;
  const adapterRoute = primaryAssignment?.result?.adapterId ?? primaryAssignment?.selectedAdapter;

  return {
    runId: report.runId,
    reportId: report.reportId,
    recordedAt: report.recordedAt,
    runStatus: report.run.status,
    hasOperatorSurface: operatorSurface !== undefined,
    directorGoal: operatorSurface?.directorGoal ?? report.run.goal,
    ...(operatorSurface?.operatorSummary !== undefined
      ? { operatorSummary: operatorSurface.operatorSummary }
      : report.run.previewSummary.trim().length > 0 && report.run.previewSummary !== report.run.goal
        ? { operatorSummary: report.run.previewSummary }
        : {}),
    ...(operatorSurface?.objective !== undefined
      ? { objective: operatorSurface.objective }
      : primaryAssignment?.objective === undefined
        ? {}
        : { objective: primaryAssignment.objective }),
    ...(operatorSurface?.deliverable !== undefined
      ? { deliverable: operatorSurface.deliverable }
      : primaryAssignment?.deliverable === undefined
        ? {}
        : { deliverable: primaryAssignment.deliverable }),
    ...(operatorSurface?.adapterRoute !== undefined
      ? { adapterRoute: operatorSurface.adapterRoute }
      : adapterRoute === undefined || adapterRoute === null
        ? {}
        : {
            adapterRoute,
          }),
    ...(operatorSurface?.lastBridgeRoute !== undefined
      ? { lastBridgeRoute: operatorSurface.lastBridgeRoute }
      : {}),
    ...(operatorSurface?.bridgeVerdict !== undefined
      ? { bridgeVerdict: operatorSurface.bridgeVerdict }
      : bridgeExecution === undefined
        ? {}
        : bridgeExecution.failure !== undefined
          ? { bridgeVerdict: "failed" as const }
          : {
              bridgeVerdict:
                bridgeExecution.response?.accepted === true
                  ? ("accepted" as const)
                  : ("responded" as const),
            }),
    ...(operatorSurface?.bridgeFailureReason !== undefined
      ? { bridgeFailureReason: operatorSurface.bridgeFailureReason }
      : bridgeExecution?.failure?.reason === undefined
        ? {}
        : { bridgeFailureReason: bridgeExecution.failure.reason }),
    ...(operatorSurface?.retryable !== undefined
      ? { retryable: operatorSurface.retryable }
      : bridgeExecution?.failure?.retryable === undefined
        ? {}
        : { retryable: bridgeExecution.failure.retryable }),
    ...(operatorSurface?.retryAllowed !== undefined
      ? { retryAllowed: operatorSurface.retryAllowed }
      : operatorSurface?.retryable !== undefined
        ? { retryAllowed: operatorSurface.retryable }
        : bridgeExecution?.failure?.retryable === undefined
          ? {}
          : { retryAllowed: bridgeExecution.failure.retryable }),
    ...(operatorSurface?.rerouteCandidates !== undefined
      ? { rerouteCandidates: operatorSurface.rerouteCandidates }
      : {}),
    ...(holdingStateSurface === undefined ? {} : { holdingState: holdingStateSurface.verdictText }),
    ...(holdingStateSurface === undefined
      ? {}
      : { holdingSummary: holdingStateSurface.summaryText }),
    ...(holdingStateSurface === undefined
      ? {}
      : { suggestedCommands: holdingStateSurface.suggestedCommands }),
    ...(operatorSurface?.nextAction !== undefined
      ? { nextAction: operatorSurface.nextAction }
      : holdingStateSurface !== undefined
        ? { nextAction: holdingStateSurface.nextAction }
        : bridgeExecution === undefined
          ? {}
          : bridgeExecution.failure !== undefined
            ? { nextAction: describeBridgeFailureNextAction(bridgeExecution.failure) }
            : { nextAction: describeBridgeSuccessNextAction(bridgeExecution.response?.requestId) }),
    ...(routeHealth.length === 0 ? {} : { routeHealth: routeHealth.map(toStatusRouteHealthEntry) }),
  };
}

function toStatusRouteHealthEntry(
  entry: DirectorRouteHealthEntry,
): DirectorExecutionRouteHealthSummary {
  return {
    assignmentId: entry.assignmentId,
    role: entry.role,
    status: entry.status,
    ...(entry.currentRoute === undefined ? {} : { currentRoute: entry.currentRoute }),
    ...(entry.lastBridgeRoute === undefined ? {} : { lastBridgeRoute: entry.lastBridgeRoute }),
    ...(entry.bridgeVerdict === undefined ? {} : { bridgeVerdict: entry.bridgeVerdict }),
    ...(entry.bridgeFailureReason === undefined
      ? {}
      : { bridgeFailureReason: entry.bridgeFailureReason }),
    ...(entry.bridgeFailureMessage === undefined
      ? {}
      : { bridgeFailureMessage: entry.bridgeFailureMessage }),
    ...(entry.bridgeStatus === undefined ? {} : { bridgeStatus: entry.bridgeStatus }),
    ...(entry.bridgeRetryable === undefined ? {} : { bridgeRetryable: entry.bridgeRetryable }),
    ...(entry.retryAllowed === undefined ? {} : { retryAllowed: entry.retryAllowed }),
    rerouteCandidates: entry.rerouteCandidates,
    ...(entry.blockingReason === undefined ? {} : { blockingReason: entry.blockingReason }),
  };
}

function describeBridgeFailureNextAction(failure: {
  readonly reason: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}): string {
  return describeDirectorBridgeFailureNextAction(failure);
}

function describeBridgeSuccessNextAction(requestId: string | undefined): string {
  if (requestId !== undefined) {
    return "track the remote request by request id and wait for the downstream result.";
  }
  return "wait for the downstream result and follow up from the operator lane.";
}

function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
}
