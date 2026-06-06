import { randomUUID } from "node:crypto";

import type {
  AssignmentResult,
  AssignmentRun,
  AssignmentRunStatus,
  ExecutionBridgeExecution,
  ExecutionBridgeFailure,
  ExecutionEvent,
  ExecutionRun,
  ExecutionRunReport,
  ExecutionRunReportOperatorSurface,
  ExecutionRunStatus,
} from "@hotflow/director-execution-contracts";

import {
  describeExecutionBridgeFailureNextAction,
  describeExecutionBridgeRetryConflict,
} from "./bridge-failure-guidance.js";
import { deriveExecutionBridgeReport } from "./bridge-metrics.js";
import { ExecutionRunBuilder } from "./builder.js";
import type {
  ClaimedAssignment,
  ExecutionRunServiceOptions,
  ExecutionRunSource,
  ExecutionSafetyPolicy,
} from "./types.js";

const TERMINAL_ASSIGNMENT_STATUSES = new Set<AssignmentRunStatus>([
  "completed",
  "failed",
  "aborted",
  "skipped",
]);

const TERMINAL_RUN_STATUSES = new Set<ExecutionRunStatus>(["completed", "failed", "aborted"]);
const RETRY_REQUEST_NOTE_PREFIX = "Retry requested at ";
const REROUTE_REQUEST_NOTE_PREFIX = "Adapter rerouted from ";
const OPERATOR_APPROVAL_NOTE_PREFIX = "Approved by operator at ";
const RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT = 1;

export class ExecutionRunService {
  private readonly builder: ExecutionRunBuilder;
  private readonly eventIdProvider: () => string;
  private readonly clock: () => string;

  public constructor(private readonly options: ExecutionRunServiceOptions) {
    this.builder = options.builder ?? new ExecutionRunBuilder();
    this.eventIdProvider = options.eventIdProvider ?? (() => randomUUID());
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async createRunFromBlueprint(source: ExecutionRunSource): Promise<ExecutionRun> {
    const baseRun = this.builder.buildFromBlueprint(source);
    const createdEvent = this.createEvent(baseRun.runId, "run-created", {
      message: "Execution run was materialized from a reviewed director blueprint.",
      payload: {
        blueprintId: source.blueprintId,
        handoffId: source.handoff.handoffId,
        assignmentCount: baseRun.assignments.length,
      },
    });
    const run: ExecutionRun = {
      ...baseRun,
      updatedAt: createdEvent.occurredAt,
      events: [createdEvent],
    };

    await this.persistRun(run, [createdEvent]);
    return run;
  }

  public async getRun(runId: string): Promise<ExecutionRun | null> {
    return this.options.store.loadRun(runId);
  }

  public async startRun(runId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "running") {
      return run;
    }
    if (run.status === "paused") {
      throw new Error(`Execution run ${runId} is paused. Use resumeRun() instead of startRun().`);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }

    const startedAt = this.clock();
    let nextRun: ExecutionRun = {
      ...run,
      status: "running",
      startedAt: run.startedAt ?? startedAt,
      updatedAt: startedAt,
    };
    const events: ExecutionEvent[] = [
      this.createEvent(run.runId, "run-status-changed", {
        occurredAt: startedAt,
        message: "Execution run entered the running state.",
        payload: {
          previousStatus: run.status,
          nextStatus: "running",
        },
      }),
    ];

    if (nextRun.assignments.length === 0) {
      nextRun = {
        ...nextRun,
        status: "completed",
        completedAt: startedAt,
      };
      events.push(
        this.createEvent(run.runId, "run-status-changed", {
          occurredAt: startedAt,
          message: "Execution run completed immediately because there were no assignments.",
          payload: {
            previousStatus: "running",
            nextStatus: "completed",
          },
        }),
      );
    }

    nextRun = {
      ...nextRun,
      events: [...nextRun.events, ...events],
    };
    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async pauseRun(runId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "paused") {
      return run;
    }
    if (run.status === "created") {
      throw new Error(`Execution run ${runId} has not started yet. Use startRun() first.`);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }

    const occurredAt = this.clock();
    const event = this.createEvent(run.runId, "run-status-changed", {
      occurredAt,
      message: "Execution run entered the paused state.",
      payload: {
        previousStatus: run.status,
        nextStatus: "paused",
      },
    });
    const nextRun: ExecutionRun = {
      ...run,
      status: "paused",
      updatedAt: occurredAt,
      events: [...run.events, event],
    };

    await this.persistRun(nextRun, [event]);
    return nextRun;
  }

  public async resumeRun(runId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "running") {
      return run;
    }
    if (run.status === "created") {
      throw new Error(`Execution run ${runId} has not started yet. Use startRun() first.`);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }
    if (run.status !== "paused") {
      throw new Error(`Execution run ${runId} cannot be resumed from status ${run.status}.`);
    }

    const occurredAt = this.clock();
    const event = this.createEvent(run.runId, "run-status-changed", {
      occurredAt,
      message: "Execution run resumed from the paused state.",
      payload: {
        previousStatus: run.status,
        nextStatus: "running",
      },
    });
    const nextRun: ExecutionRun = {
      ...run,
      status: "running",
      updatedAt: occurredAt,
      events: [...run.events, event],
    };

    await this.persistRun(nextRun, [event]);
    return nextRun;
  }

  public async abortRun(runId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "aborted") {
      return run;
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }

    const occurredAt = this.clock();
    const events: ExecutionEvent[] = [];
    const assignments = run.assignments.map((assignment) => {
      if (TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status)) {
        return assignment;
      }

      const abortedAssignment: AssignmentRun = {
        ...assignment,
        status: "aborted",
        completedAt: occurredAt,
        notes: dedupeStrings([...(assignment.notes ?? []), "Aborted by operator control."]),
      };
      events.push(
        this.createEvent(run.runId, "assignment-status-changed", {
          occurredAt,
          message: `Assignment ${assignment.assignmentId} was aborted by operator control.`,
          payload: {
            assignmentId: assignment.assignmentId,
            previousStatus: assignment.status,
            nextStatus: abortedAssignment.status,
          },
        }),
      );
      return abortedAssignment;
    });

    events.push(
      this.createEvent(run.runId, "run-status-changed", {
        occurredAt,
        message: "Execution run was aborted by operator control.",
        payload: {
          previousStatus: run.status,
          nextStatus: "aborted",
        },
      }),
    );

    const nextRun: ExecutionRun = {
      ...run,
      status: "aborted",
      updatedAt: occurredAt,
      completedAt: occurredAt,
      assignments,
      events: [...run.events, ...events],
    };

    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async retryAssignment(runId: string, assignmentId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "created") {
      throw new Error(`Execution run ${runId} has not started yet. Use startRun() first.`);
    }
    if (run.status === "completed") {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }
    if (run.status === "aborted") {
      throw new Error(`Execution run ${runId} was aborted and cannot retry assignments.`);
    }

    const currentAssignment = run.assignments.find(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (!currentAssignment) {
      throw new Error(`Execution run ${runId} does not contain assignment ${assignmentId}.`);
    }
    if (
      currentAssignment.status !== "failed" &&
      currentAssignment.status !== "aborted" &&
      currentAssignment.status !== "blocked" &&
      currentAssignment.status !== "skipped"
    ) {
      throw new Error(
        `Assignment ${assignmentId} cannot be retried from status ${currentAssignment.status}.`,
      );
    }
    throwIfBridgeRetryIsDisallowed(currentAssignment);

    const occurredAt = this.clock();
    const events: ExecutionEvent[] = [];
    const currentRoute = resolveConfiguredAdapterRoute(currentAssignment);
    const retryState = deriveBridgeRetryState(currentAssignment);
    const assignmentById = new Map(
      run.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );

    const assignments = run.assignments.map((assignment) => {
      if (assignment.assignmentId === assignmentId) {
        const nextStatus =
          assignment.approvalMode === "auto_allow" &&
          this.dependenciesSatisfied(assignment, [...assignmentById.values()])
            ? "ready"
            : "pending";
        const {
          startedAt: _startedAt,
          completedAt: _completedAt,
          result: _result,
          blockingReason: _blockingReason,
          ...assignmentBase
        } = assignment;
        const retriedAssignment: AssignmentRun = {
          ...assignmentBase,
          status: nextStatus,
          notes: dedupeStrings([
            ...(assignment.notes ?? []),
            `${RETRY_REQUEST_NOTE_PREFIX}${occurredAt}.`,
          ]),
        };
        events.push(
          this.createEvent(run.runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignmentId} was reset for retry.`,
            payload: {
              assignmentId,
              previousStatus: assignment.status,
              nextStatus: retriedAssignment.status,
              ...(currentRoute === null ? {} : { adapterId: currentRoute }),
              ...(retryState === undefined
                ? {}
                : {
                    retryCount: retryState.retriesUsed + 1,
                    retryLimit: retryState.retryLimit,
                  }),
            },
          }),
        );
        assignmentById.set(assignment.assignmentId, retriedAssignment);
        return retriedAssignment;
      }

      if (assignment.status === "blocked" && assignment.dependsOn.includes(assignmentId)) {
        const {
          blockingReason: _blockingReason,
          completedAt: _completedAt,
          ...assignmentBase
        } = assignment;
        const reopenedAssignment: AssignmentRun = {
          ...assignmentBase,
          status: "pending",
          notes: dedupeStrings([
            ...(assignment.notes ?? []),
            `Reopened because dependency ${assignmentId} is being retried.`,
          ]),
        };
        events.push(
          this.createEvent(run.runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignment.assignmentId} returned to pending because dependency ${assignmentId} is being retried.`,
            payload: {
              assignmentId: assignment.assignmentId,
              previousStatus: assignment.status,
              nextStatus: reopenedAssignment.status,
              dependencyId: assignmentId,
            },
          }),
        );
        assignmentById.set(assignment.assignmentId, reopenedAssignment);
        return reopenedAssignment;
      }

      return assignment;
    });

    const { completedAt: _completedAt, ...runBase } = run;
    const nextStatus = run.status === "paused" ? "paused" : "running";
    if (nextStatus !== run.status) {
      events.push(
        this.createEvent(run.runId, "run-status-changed", {
          occurredAt,
          message: `Execution run changed status from ${run.status} to ${nextStatus}.`,
          payload: {
            previousStatus: run.status,
            nextStatus,
          },
        }),
      );
    }

    const nextRun: ExecutionRun = {
      ...runBase,
      status: nextStatus,
      updatedAt: occurredAt,
      assignments,
      events: [...run.events, ...events],
    };

    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async rerouteAssignment(
    runId: string,
    assignmentId: string,
    adapterId: string,
  ): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status === "created") {
      throw new Error(`Execution run ${runId} has not started yet. Use startRun() first.`);
    }
    if (run.status === "completed") {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }
    if (run.status === "aborted") {
      throw new Error(`Execution run ${runId} was aborted and cannot reroute assignments.`);
    }

    const currentAssignment = run.assignments.find(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (!currentAssignment) {
      throw new Error(`Execution run ${runId} does not contain assignment ${assignmentId}.`);
    }
    if (
      currentAssignment.status !== "failed" &&
      currentAssignment.status !== "aborted" &&
      currentAssignment.status !== "blocked" &&
      currentAssignment.status !== "skipped"
    ) {
      throw new Error(
        `Assignment ${assignmentId} cannot be rerouted from status ${currentAssignment.status}.`,
      );
    }

    const nextAdapterId = adapterId.trim();
    if (nextAdapterId.length === 0) {
      throw new Error(`Assignment ${assignmentId} requires a non-empty reroute adapter id.`);
    }

    const allowedAdapters = currentAssignment.allowedAdapters ?? [];
    if (!allowedAdapters.includes(nextAdapterId)) {
      throw new Error(
        `Assignment ${assignmentId} cannot reroute to ${nextAdapterId} because it is not in the approved adapter set (${allowedAdapters.join(", ") || "(none)"}).`,
      );
    }

    const currentRoute = resolveConfiguredAdapterRoute(currentAssignment);
    if (currentRoute === nextAdapterId) {
      throw new Error(
        `Assignment ${assignmentId} is already routed to ${nextAdapterId}; choose a different approved adapter.`,
      );
    }

    const alternativeRoutes = collectRerouteCandidates(currentAssignment);
    if (alternativeRoutes.length === 0) {
      throw new Error(
        `Assignment ${assignmentId} does not have an approved alternate adapter to reroute to.`,
      );
    }

    const occurredAt = this.clock();
    const event = this.createEvent(run.runId, "log", {
      occurredAt,
      message: `Assignment ${assignmentId} rerouted from ${currentRoute ?? "none"} to ${nextAdapterId}.`,
      payload: {
        assignmentId,
        previousAdapterId: currentRoute,
        nextAdapterId,
      },
    });

    const assignments = run.assignments.map((assignment) =>
      assignment.assignmentId !== assignmentId
        ? assignment
        : {
            ...assignment,
            selectedAdapter: nextAdapterId,
            notes: dedupeStrings([
              ...(assignment.notes ?? []),
              `${REROUTE_REQUEST_NOTE_PREFIX}${currentRoute ?? "none"} to ${nextAdapterId} at ${occurredAt}.`,
            ]),
          },
    );

    const nextRun: ExecutionRun = {
      ...run,
      updatedAt: occurredAt,
      assignments,
      events: [...run.events, event],
    };

    await this.persistRun(nextRun, [event]);
    return nextRun;
  }

  public async approveAssignment(runId: string, assignmentId: string): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Execution run ${runId} is already terminal (${run.status}).`);
    }

    const currentAssignment = run.assignments.find(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (!currentAssignment) {
      throw new Error(`Execution run ${runId} does not contain assignment ${assignmentId}.`);
    }
    if (currentAssignment.approvalMode !== "operator_approve") {
      throw new Error(`Assignment ${assignmentId} does not require operator approval.`);
    }
    if (currentAssignment.status !== "pending") {
      throw new Error(
        `Assignment ${assignmentId} cannot be approved from status ${currentAssignment.status}.`,
      );
    }

    const occurredAt = this.clock();
    const assignmentById = new Map(
      run.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );
    const nextAssignmentStatus = this.dependenciesSatisfied(currentAssignment, [
      ...assignmentById.values(),
    ])
      ? "ready"
      : "pending";
    const {
      blockingReason: _blockingReason,
      completedAt: _completedAt,
      startedAt: _startedAt,
      ...assignmentBase
    } = currentAssignment;
    const approvedAssignment: AssignmentRun = {
      ...assignmentBase,
      approvalMode: "auto_allow",
      status: nextAssignmentStatus,
      notes: dedupeStrings([
        ...(currentAssignment.notes ?? []),
        `${OPERATOR_APPROVAL_NOTE_PREFIX}${occurredAt}.`,
      ]),
    };
    const events: ExecutionEvent[] = [
      this.createEvent(run.runId, "assignment-status-changed", {
        occurredAt,
        message:
          nextAssignmentStatus === "ready"
            ? `Assignment ${assignmentId} was approved by the operator and is ready to run.`
            : `Assignment ${assignmentId} was approved by the operator and is waiting on dependencies.`,
        payload: {
          assignmentId,
          previousStatus: currentAssignment.status,
          nextStatus: approvedAssignment.status,
          previousApprovalMode: currentAssignment.approvalMode,
          nextApprovalMode: approvedAssignment.approvalMode,
        },
      }),
    ];

    const assignments = run.assignments.map((assignment) =>
      assignment.assignmentId === assignmentId ? approvedAssignment : assignment,
    );
    const nextStatus =
      run.status === "created" ? "created" : this.deriveRunStatus(run.status, assignments);
    if (nextStatus !== run.status) {
      events.push(
        this.createEvent(run.runId, "run-status-changed", {
          occurredAt,
          message: `Execution run changed status from ${run.status} to ${nextStatus}.`,
          payload: {
            previousStatus: run.status,
            nextStatus,
          },
        }),
      );
    }

    const nextRun: ExecutionRun = {
      ...run,
      status: nextStatus,
      updatedAt: occurredAt,
      assignments,
      events: [...run.events, ...events],
    };

    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async applySafetyPolicy(
    runId: string,
    policy: ExecutionSafetyPolicy = {},
  ): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return run;
    }

    const occurredAt = this.clock();
    const disabledRoles = new Set(policy.disabledRoles ?? []);
    const disabledAdapters = new Set(policy.disabledAdapters ?? []);
    const events: ExecutionEvent[] = [];
    let changed = false;

    const gatedAssignments = run.assignments.map((assignment) => {
      const timeoutAssignment = this.tryTimeoutAssignment(assignment, occurredAt);
      if (timeoutAssignment) {
        changed = true;
        events.push(timeoutAssignment.event);
        return timeoutAssignment.assignment;
      }

      if (assignment.status !== "ready" && assignment.status !== "pending") {
        return assignment;
      }

      if (disabledRoles.has(assignment.role)) {
        changed = true;
        const skippedAssignment = this.toSkippedAssignment(
          assignment,
          occurredAt,
          `Role ${assignment.role} is disabled by execution safety policy.`,
        );
        events.push(
          this.createEvent(run.runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignment.assignmentId} was skipped because role ${assignment.role} is disabled.`,
            payload: {
              assignmentId: assignment.assignmentId,
              previousStatus: assignment.status,
              nextStatus: skippedAssignment.status,
              role: assignment.role,
            },
          }),
        );
        return skippedAssignment;
      }

      const disabledAdapter = this.findDisabledAdapter(assignment, disabledAdapters);
      if (disabledAdapter !== null) {
        changed = true;
        const blockedAssignment = this.toBlockedAssignment(
          assignment,
          `Adapter ${disabledAdapter} is disabled by execution safety policy.`,
        );
        events.push(
          this.createEvent(run.runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignment.assignmentId} is blocked because adapter ${disabledAdapter} is disabled.`,
            payload: {
              assignmentId: assignment.assignmentId,
              previousStatus: assignment.status,
              nextStatus: blockedAssignment.status,
              adapterId: disabledAdapter,
            },
          }),
        );
        return blockedAssignment;
      }

      return assignment;
    });

    const advancedAssignments = this.advanceAssignments(run.runId, gatedAssignments, occurredAt);
    events.push(...advancedAssignments.events);

    let nextStatus = this.deriveRunStatus(run.status, advancedAssignments.assignments);
    if (policy.executionEnabled === false || policy.pauseAll === true) {
      if (run.status === "running" && nextStatus === "running") {
        nextStatus = "paused";
      }
    }

    if (!changed && advancedAssignments.events.length === 0 && nextStatus === run.status) {
      return run;
    }

    if (nextStatus !== run.status) {
      events.push(
        this.createEvent(run.runId, "run-status-changed", {
          occurredAt,
          message:
            nextStatus === "paused"
              ? "Execution run was paused by execution safety policy."
              : `Execution run changed status from ${run.status} to ${nextStatus}.`,
          payload: {
            previousStatus: run.status,
            nextStatus,
          },
        }),
      );
    }

    const nextCompletedAt =
      TERMINAL_RUN_STATUSES.has(nextStatus) && run.completedAt === undefined
        ? occurredAt
        : run.completedAt;
    const nextRun: ExecutionRun = {
      ...run,
      status: nextStatus,
      updatedAt: occurredAt,
      assignments: advancedAssignments.assignments,
      events: [...run.events, ...events],
      ...(nextCompletedAt === undefined ? {} : { completedAt: nextCompletedAt }),
    };

    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async claimNextReadyAssignment(
    runId: string,
    workerId = "director-worker",
  ): Promise<ClaimedAssignment | null> {
    const run = await this.loadRunOrThrow(runId);
    if (run.status !== "running") {
      return null;
    }

    const roleScopedWorker = isRoleScopedWorker(workerId, run.assignments);
    const nextAssignment = run.assignments.find(
      (assignment) =>
        assignment.status === "ready" &&
        this.dependenciesSatisfied(assignment, run.assignments) &&
        (!roleScopedWorker || defaultWorkerIdForRole(assignment.role) === workerId),
    );
    if (!nextAssignment) {
      return null;
    }

    const occurredAt = this.clock();
    const claimedAssignment: AssignmentRun = {
      ...nextAssignment,
      status: "running",
      startedAt: nextAssignment.startedAt ?? occurredAt,
    };
    const event = this.createEvent(run.runId, "assignment-status-changed", {
      occurredAt,
      message: `Assignment ${nextAssignment.assignmentId} was claimed by worker ${workerId}.`,
      metadata: {
        workerId,
      },
      payload: {
        assignmentId: nextAssignment.assignmentId,
        previousStatus: nextAssignment.status,
        nextStatus: claimedAssignment.status,
      },
    });

    const updatedRun: ExecutionRun = {
      ...run,
      updatedAt: occurredAt,
      assignments: run.assignments.map((assignment) =>
        assignment.assignmentId === claimedAssignment.assignmentId ? claimedAssignment : assignment,
      ),
      events: [...run.events, event],
    };
    await this.persistRun(updatedRun, [event]);
    return {
      run: updatedRun,
      assignment: claimedAssignment,
    };
  }

  public async completeAssignment(
    runId: string,
    assignmentId: string,
    result: AssignmentResult,
  ): Promise<ExecutionRun> {
    const run = await this.loadRunOrThrow(runId);
    const currentAssignment = run.assignments.find(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (!currentAssignment) {
      throw new Error(`Execution run ${runId} does not contain assignment ${assignmentId}.`);
    }
    if (currentAssignment.status !== "running") {
      throw new Error(
        `Assignment ${assignmentId} must be running before it can complete (current: ${currentAssignment.status}).`,
      );
    }

    const events: ExecutionEvent[] = [];
    const updatedAssignments = run.assignments.map((assignment) => {
      if (assignment.assignmentId !== assignmentId) {
        return assignment;
      }
      const completedAssignment: AssignmentRun = {
        ...assignment,
        status: result.status,
        completedAt: result.recordedAt,
        selectedAdapter: result.adapterId ?? assignment.selectedAdapter ?? null,
        result,
        notes: dedupeStrings([...(assignment.notes ?? []), ...(result.notes ?? [])]),
      };
      events.push(
        this.createEvent(run.runId, "assignment-status-changed", {
          occurredAt: result.recordedAt,
          message: `Assignment ${assignmentId} finished with status ${result.status}.`,
          metadata: {
            workerId: result.workerId,
          },
          payload: {
            assignmentId,
            previousStatus: assignment.status,
            nextStatus: completedAssignment.status,
            summary: result.summary,
            adapterId: result.adapterId ?? assignment.selectedAdapter ?? null,
            ...buildBridgeEventPayload(result.bridgeExecution),
          },
        }),
      );
      return completedAssignment;
    });

    const advancedAssignments = this.advanceAssignments(
      run.runId,
      updatedAssignments,
      result.recordedAt,
    );
    events.push(...advancedAssignments.events);

    const nextStatus = this.deriveRunStatus(run.status, advancedAssignments.assignments);
    if (nextStatus !== run.status) {
      events.push(
        this.createEvent(run.runId, "run-status-changed", {
          occurredAt: result.recordedAt,
          message: `Execution run changed status from ${run.status} to ${nextStatus}.`,
          payload: {
            previousStatus: run.status,
            nextStatus,
          },
        }),
      );
    }

    const nextCompletedAt =
      TERMINAL_RUN_STATUSES.has(nextStatus) && run.completedAt === undefined
        ? result.recordedAt
        : run.completedAt;
    const nextRun: ExecutionRun = {
      ...run,
      status: nextStatus,
      updatedAt: result.recordedAt,
      assignments: advancedAssignments.assignments,
      events: [...run.events, ...events],
      ...(nextCompletedAt === undefined ? {} : { completedAt: nextCompletedAt }),
    };
    await this.persistRun(nextRun, events);
    return nextRun;
  }

  public async collectRunReport(runId: string): Promise<ExecutionRunReport> {
    const run = await this.loadRunOrThrow(runId);
    const counts = countAssignments(run.assignments);
    const bridgeExecutions = collectBridgeExecutions(run.assignments);
    const bridgeMetrics = deriveExecutionBridgeReport(run.assignments);
    const bridgeSucceeded = bridgeExecutions.filter((execution) => execution.failure === undefined);
    const bridgeFailed = bridgeExecutions.filter((execution) => execution.failure !== undefined);
    const flags = dedupeStrings([
      run.sideEffectsAllowed === false || run.notes?.includes("preview-only")
        ? "preview-only"
        : null,
      run.status === "paused" ? "run-paused" : null,
      counts.failed > 0 ? "has-failures" : null,
      counts.blocked > 0 ? "has-blocked-assignments" : null,
      counts.pending > 0 ? "awaiting-approval-or-dependencies" : null,
      counts.running > 0 ? "run-in-progress" : null,
      counts.skipped > 0 ? "has-skipped-assignments" : null,
      counts.aborted > 0 ? "has-aborted-assignments" : null,
      bridgeExecutions.length > 0 ? "external-bridge-attempted" : null,
      bridgeSucceeded.length > 0 ? "external-bridge-succeeded" : null,
      bridgeFailed.length > 0 ? "external-bridge-failed" : null,
    ]);
    const report: ExecutionRunReport = {
      schemaVersion: run.schemaVersion,
      reportId: `report-${run.runId}`,
      runId: run.runId,
      run,
      recordedAt: this.clock(),
      summary: dedupeStrings([
        `run status=${run.status}`,
        `assignments total=${run.assignments.length} ready=${counts.ready} pending=${counts.pending} running=${counts.running} completed=${counts.completed} failed=${counts.failed} blocked=${counts.blocked}`,
        ...(bridgeExecutions.length === 0
          ? []
          : [
              `bridge attempts=${bridgeExecutions.length} succeeded=${bridgeSucceeded.length} failed=${bridgeFailed.length}`,
            ]),
      ]),
      flags,
      operatorSurface: buildExecutionRunOperatorSurface(run, bridgeMetrics),
      ...(bridgeMetrics === undefined ? {} : { bridgeMetrics }),
      events: [...run.events],
    };
    await this.options.store.saveReport(report);
    return report;
  }

  public async getReport(runId: string): Promise<ExecutionRunReport | null> {
    return this.options.store.loadReport(runId);
  }

  private advanceAssignments(
    runId: string,
    assignments: readonly AssignmentRun[],
    occurredAt: string,
  ): { readonly assignments: AssignmentRun[]; readonly events: ExecutionEvent[] } {
    const events: ExecutionEvent[] = [];
    let changed = false;
    const assignmentById = new Map(
      assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );

    const nextAssignments = assignments.map((assignment) => {
      if (assignment.status !== "pending") {
        return assignment;
      }
      const dependencyStates = assignment.dependsOn.map(
        (dependencyId) => assignmentById.get(dependencyId)?.status,
      );
      const failedDependency = assignment.dependsOn.find((dependencyId) => {
        const dependencyStatus = assignmentById.get(dependencyId)?.status;
        return (
          dependencyStatus === "failed" ||
          dependencyStatus === "aborted" ||
          dependencyStatus === "skipped"
        );
      });
      if (failedDependency) {
        changed = true;
        const blockedAssignment: AssignmentRun = {
          ...assignment,
          status: "blocked",
          notes: dedupeStrings([
            ...(assignment.notes ?? []),
            `Blocked because dependency ${failedDependency} did not complete successfully.`,
          ]),
        };
        events.push(
          this.createEvent(runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignment.assignmentId} is blocked by dependency ${failedDependency}.`,
            payload: {
              assignmentId: assignment.assignmentId,
              previousStatus: assignment.status,
              nextStatus: blockedAssignment.status,
              dependencyId: failedDependency,
            },
          }),
        );
        return blockedAssignment;
      }

      const dependenciesSatisfied =
        assignment.dependsOn.length === 0 ||
        dependencyStates.every((status) => status === "completed");

      if (dependenciesSatisfied && assignment.approvalMode === "auto_allow") {
        changed = true;
        const readyAssignment: AssignmentRun = {
          ...assignment,
          status: "ready",
        };
        events.push(
          this.createEvent(runId, "assignment-status-changed", {
            occurredAt,
            message: `Assignment ${assignment.assignmentId} is ready to run.`,
            payload: {
              assignmentId: assignment.assignmentId,
              previousStatus: assignment.status,
              nextStatus: readyAssignment.status,
            },
          }),
        );
        return readyAssignment;
      }

      return assignment;
    });

    return {
      assignments: changed ? nextAssignments : [...assignments],
      events,
    };
  }

  private deriveRunStatus(
    currentStatus: ExecutionRunStatus,
    assignments: readonly AssignmentRun[],
  ): ExecutionRunStatus {
    if (currentStatus === "aborted") {
      return "aborted";
    }
    if (currentStatus === "paused") {
      if (assignments.some((assignment) => assignment.status === "failed")) {
        return "failed";
      }
      if (assignments.some((assignment) => assignment.status === "blocked")) {
        return "failed";
      }
      if (
        assignments.length > 0 &&
        assignments.every((assignment) => TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status))
      ) {
        return "completed";
      }
      return "paused";
    }
    if (assignments.some((assignment) => assignment.status === "failed")) {
      return "failed";
    }
    if (assignments.some((assignment) => assignment.status === "running")) {
      return "running";
    }
    if (assignments.some((assignment) => assignment.status === "ready")) {
      return "running";
    }
    if (assignments.some((assignment) => assignment.status === "pending")) {
      return "running";
    }
    if (assignments.some((assignment) => assignment.status === "blocked")) {
      return "failed";
    }
    if (
      assignments.length > 0 &&
      assignments.every((assignment) => TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status))
    ) {
      return "completed";
    }
    return currentStatus;
  }

  private dependenciesSatisfied(
    assignment: AssignmentRun,
    assignments: readonly AssignmentRun[],
  ): boolean {
    if (assignment.dependsOn.length === 0) {
      return true;
    }
    const assignmentById = new Map(assignments.map((entry) => [entry.assignmentId, entry]));
    return assignment.dependsOn.every(
      (dependencyId) => assignmentById.get(dependencyId)?.status === "completed",
    );
  }

  private tryTimeoutAssignment(
    assignment: AssignmentRun,
    occurredAt: string,
  ): { readonly assignment: AssignmentRun; readonly event: ExecutionEvent } | null {
    if (
      assignment.status !== "running" ||
      assignment.timeoutMs === undefined ||
      assignment.startedAt === undefined
    ) {
      return null;
    }

    const startedAtMs = Date.parse(assignment.startedAt);
    const occurredAtMs = Date.parse(occurredAt);
    if (
      Number.isNaN(startedAtMs) ||
      Number.isNaN(occurredAtMs) ||
      occurredAtMs - startedAtMs < assignment.timeoutMs
    ) {
      return null;
    }

    const timedOutAssignment: AssignmentRun = {
      ...assignment,
      status: "failed",
      completedAt: occurredAt,
      result: {
        runId: assignment.runId,
        assignmentId: assignment.assignmentId,
        status: "failed",
        recordedAt: occurredAt,
        workerId: "director-worker-timeout",
        summary: `Assignment ${assignment.assignmentId} timed out after ${assignment.timeoutMs}ms.`,
        adapterId: assignment.selectedAdapter ?? null,
        notes: ["timeout", "recovered-by-safety-policy"],
      },
      notes: dedupeStrings([
        ...(assignment.notes ?? []),
        `Timed out after ${assignment.timeoutMs}ms and was failed by execution safety policy.`,
      ]),
    };

    return {
      assignment: timedOutAssignment,
      event: this.createEvent(assignment.runId, "assignment-status-changed", {
        occurredAt,
        message: `Assignment ${assignment.assignmentId} timed out and was marked failed.`,
        metadata: {
          workerId: "director-worker-timeout",
        },
        payload: {
          assignmentId: assignment.assignmentId,
          previousStatus: assignment.status,
          nextStatus: timedOutAssignment.status,
          timeoutMs: assignment.timeoutMs,
        },
      }),
    };
  }

  private toSkippedAssignment(
    assignment: AssignmentRun,
    occurredAt: string,
    reason: string,
  ): AssignmentRun {
    const { blockingReason: _blockingReason, ...assignmentBase } = assignment;
    return {
      ...assignmentBase,
      status: "skipped",
      completedAt: occurredAt,
      notes: dedupeStrings([...(assignment.notes ?? []), reason]),
    };
  }

  private toBlockedAssignment(assignment: AssignmentRun, reason: string): AssignmentRun {
    const { completedAt: _completedAt, result: _result, ...assignmentBase } = assignment;
    return {
      ...assignmentBase,
      status: "blocked",
      blockingReason: reason,
      notes: dedupeStrings([...(assignment.notes ?? []), reason]),
    };
  }

  private findDisabledAdapter(
    assignment: AssignmentRun,
    disabledAdapters: ReadonlySet<string>,
  ): string | null {
    if (disabledAdapters.size === 0) {
      return null;
    }
    if (assignment.selectedAdapter && disabledAdapters.has(assignment.selectedAdapter)) {
      return assignment.selectedAdapter;
    }
    return assignment.allowedAdapters?.find((adapterId) => disabledAdapters.has(adapterId)) ?? null;
  }

  private async loadRunOrThrow(runId: string): Promise<ExecutionRun> {
    const run = await this.options.store.loadRun(runId);
    if (!run) {
      throw new Error(`Unknown execution run: ${runId}`);
    }
    return run;
  }

  private createEvent(
    runId: string,
    type: ExecutionEvent["type"],
    input: {
      readonly message: string;
      readonly occurredAt?: string;
      readonly metadata?: Record<string, string>;
      readonly payload?: Record<string, unknown>;
    },
  ): ExecutionEvent {
    return {
      eventId: this.eventIdProvider(),
      runId,
      type,
      occurredAt: input.occurredAt ?? this.clock(),
      message: input.message,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    };
  }

  private async persistRun(run: ExecutionRun, events: readonly ExecutionEvent[]): Promise<void> {
    await this.options.store.saveRun(run);
    for (const event of events) {
      await this.options.store.appendEvent(event);
    }
  }
}

function buildExecutionRunOperatorSurface(
  run: ExecutionRun,
  bridgeMetrics: ExecutionRunReport["bridgeMetrics"],
): ExecutionRunReportOperatorSurface {
  const primaryAssignment =
    selectPrimaryOperatorAssignment(run) ??
    run.assignments.find((assignment) => assignment.actionClass === "generate") ??
    run.assignments[0];

  const surface: ExecutionRunReportOperatorSurface = {
    directorGoal: run.goal,
    ...(run.previewSummary.trim().length > 0 && run.previewSummary !== run.goal
      ? { operatorSummary: run.previewSummary }
      : {}),
    ...(bridgeMetrics === undefined
      ? {}
      : {
          bridgeAttempts: {
            attempts: bridgeMetrics.attempts,
            successes: bridgeMetrics.successes,
            failures: bridgeMetrics.failures,
          },
        }),
  };

  if (primaryAssignment === undefined) {
    return surface;
  }

  const bridgeExecution = primaryAssignment.result?.bridgeExecution;
  const bridgeRetryState = deriveBridgeRetryState(primaryAssignment);
  const adapterRoute = resolveConfiguredAdapterRoute(primaryAssignment);
  const lastBridgeRoute = resolveLastBridgeRoute(primaryAssignment);
  const rerouteCandidates = collectRerouteCandidates(primaryAssignment);

  return {
    ...surface,
    objective: primaryAssignment.objective,
    deliverable: primaryAssignment.deliverable,
    ...(adapterRoute === undefined || adapterRoute === null ? {} : { adapterRoute }),
    ...(lastBridgeRoute === undefined ||
    lastBridgeRoute === null ||
    lastBridgeRoute === adapterRoute
      ? {}
      : { lastBridgeRoute }),
    ...(rerouteCandidates.length === 0 ? {} : { rerouteCandidates }),
    ...(bridgeExecution === undefined
      ? {}
      : bridgeExecution.failure !== undefined
        ? {
            bridgeVerdict: "failed" as const,
            bridgeFailureReason: bridgeExecution.failure.reason,
            retryable: bridgeExecution.failure.retryable,
            retryAllowed: bridgeRetryState?.retryAllowed ?? bridgeExecution.failure.retryable,
            ...(bridgeExecution.failure.statusCode === undefined
              ? {}
              : { bridgeStatus: bridgeExecution.failure.statusCode }),
            nextAction: describeBridgeFailureNextAction(bridgeExecution.failure, bridgeRetryState),
          }
        : {
            bridgeVerdict:
              bridgeExecution.response?.accepted === true
                ? ("accepted" as const)
                : ("responded" as const),
            ...(bridgeExecution.response?.accepted === undefined
              ? {}
              : { requestAccepted: bridgeExecution.response.accepted }),
            ...(bridgeExecution.response?.statusCode === undefined
              ? {}
              : { bridgeStatus: bridgeExecution.response.statusCode }),
            ...(bridgeExecution.response?.requestId === undefined
              ? {}
              : { requestId: bridgeExecution.response.requestId }),
            nextAction: describeBridgeSuccessNextAction(bridgeExecution.response?.requestId),
          }),
  };
}

function selectPrimaryOperatorAssignment(run: ExecutionRun): AssignmentRun | undefined {
  const bridgeAssignments = run.assignments.filter(
    (assignment) => assignment.result?.bridgeExecution !== undefined,
  );
  const failedBridgeAssignment = bridgeAssignments.find(
    (assignment) => assignment.result?.bridgeExecution?.failure !== undefined,
  );

  return failedBridgeAssignment ?? bridgeAssignments[0];
}

function describeBridgeFailureNextAction(
  failure: {
    readonly reason: string;
    readonly retryable: boolean;
    readonly statusCode?: number;
  },
  options: BridgeRetryState | undefined,
): string {
  return describeExecutionBridgeFailureNextAction(failure, options);
}

function describeBridgeSuccessNextAction(requestId: string | undefined): string {
  if (requestId !== undefined) {
    return "track the remote request by request id and wait for the downstream result.";
  }
  return "wait for the downstream result and follow up from the operator lane.";
}

function buildBridgeEventPayload(
  bridgeExecution: ExecutionBridgeExecution | undefined,
): Record<string, string | number | boolean> {
  if (bridgeExecution === undefined) {
    return {};
  }

  if (bridgeExecution.failure !== undefined) {
    return {
      bridgeKind: bridgeExecution.kind,
      bridgeVerdict: "failed",
      bridgeFailureReason: bridgeExecution.failure.reason,
      bridgeRetryable: bridgeExecution.failure.retryable,
      ...(bridgeExecution.failure.statusCode === undefined
        ? {}
        : { bridgeStatus: bridgeExecution.failure.statusCode }),
    };
  }

  return {
    bridgeKind: bridgeExecution.kind,
    bridgeVerdict: bridgeExecution.response?.accepted === true ? "accepted" : "responded",
    ...(bridgeExecution.response?.accepted === undefined
      ? {}
      : { requestAccepted: bridgeExecution.response.accepted }),
    ...(bridgeExecution.response?.statusCode === undefined
      ? {}
      : { bridgeStatus: bridgeExecution.response.statusCode }),
    ...(bridgeExecution.response?.requestId === undefined
      ? {}
      : { requestId: bridgeExecution.response.requestId }),
  };
}

function countAssignments(
  assignments: readonly AssignmentRun[],
): Record<AssignmentRunStatus, number> {
  return assignments.reduce<Record<AssignmentRunStatus, number>>(
    (state, assignment) => {
      state[assignment.status] += 1;
      return state;
    },
    {
      pending: 0,
      ready: 0,
      blocked: 0,
      running: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      skipped: 0,
    },
  );
}

function throwIfBridgeRetryIsDisallowed(assignment: AssignmentRun): void {
  const retryState = deriveBridgeRetryState(assignment);
  if (retryState === undefined || retryState.retryAllowed) {
    return;
  }

  throw new Error(
    describeExecutionBridgeRetryConflict(assignment.assignmentId, retryState.failure, retryState),
  );
}

interface BridgeRetryState {
  readonly failure: ExecutionBridgeFailure;
  readonly retryAllowed: boolean;
  readonly retriesUsed: number;
  readonly retryLimit: number;
}

function deriveBridgeRetryState(assignment: AssignmentRun): BridgeRetryState | undefined {
  const failure = assignment.result?.bridgeExecution?.failure;
  if (failure === undefined) {
    return undefined;
  }

  const retriesUsed = countRetryRequests(assignment.notes);
  const retryLimit = failure.retryable ? RETRYABLE_BRIDGE_FAILURE_RETRY_LIMIT : 0;
  return {
    failure,
    retryAllowed: failure.retryable && retriesUsed < retryLimit,
    retriesUsed,
    retryLimit,
  };
}

function countRetryRequests(notes: readonly string[] | undefined): number {
  if (!notes || notes.length === 0) {
    return 0;
  }

  const lastRerouteIndex = findLastRerouteRequestIndex(notes);
  return notes
    .slice(lastRerouteIndex + 1)
    .filter((note) => note.startsWith(RETRY_REQUEST_NOTE_PREFIX)).length;
}

function findLastRerouteRequestIndex(notes: readonly string[]): number {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    if (notes[index]?.startsWith(REROUTE_REQUEST_NOTE_PREFIX)) {
      return index;
    }
  }
  return -1;
}

function findLastRetryRequestIndex(notes: readonly string[]): number {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    if (notes[index]?.startsWith(RETRY_REQUEST_NOTE_PREFIX)) {
      return index;
    }
  }
  return -1;
}

function resolveConfiguredAdapterRoute(assignment: AssignmentRun): string | null {
  const selectedAdapter = assignment.selectedAdapter ?? null;
  const resultAdapter = assignment.result?.adapterId ?? null;
  if (
    selectedAdapter !== null &&
    resultAdapter !== null &&
    selectedAdapter !== resultAdapter &&
    hasPendingReroute(assignment.notes)
  ) {
    return selectedAdapter;
  }
  return resultAdapter ?? selectedAdapter;
}

function resolveLastBridgeRoute(assignment: AssignmentRun): string | null {
  return assignment.result?.adapterId ?? null;
}

function collectRerouteCandidates(assignment: AssignmentRun): string[] {
  const configuredRoute = resolveConfiguredAdapterRoute(assignment);
  const lastBridgeRoute = resolveLastBridgeRoute(assignment);

  return dedupeStrings(
    (assignment.allowedAdapters ?? []).filter(
      (adapterId) => adapterId !== configuredRoute && adapterId !== lastBridgeRoute,
    ),
  );
}

function hasPendingReroute(notes: readonly string[] | undefined): boolean {
  if (!notes || notes.length === 0) {
    return false;
  }
  return findLastRerouteRequestIndex(notes) > findLastRetryRequestIndex(notes);
}

function collectBridgeExecutions(
  assignments: readonly AssignmentRun[],
): ExecutionBridgeExecution[] {
  return assignments.flatMap((assignment) =>
    assignment.result?.bridgeExecution ? [assignment.result.bridgeExecution] : [],
  );
}

function isRoleScopedWorker(workerId: string, assignments: readonly AssignmentRun[]): boolean {
  return assignments.some((assignment) => defaultWorkerIdForRole(assignment.role) === workerId);
}

function defaultWorkerIdForRole(role: AssignmentRun["role"]): string {
  return `director-${role}`;
}

function dedupeStrings(values: ReadonlyArray<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
}
