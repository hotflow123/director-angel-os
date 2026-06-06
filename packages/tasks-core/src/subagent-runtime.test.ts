import { describe, expect, test } from "vitest";

import {
  projectSubagentRunsFromTaskState,
  projectSubagentSchedulerDispatchPlanFromTaskState,
  projectSubagentSchedulerHeartbeatFromTaskState,
  projectSubagentSchedulerRecoveryPlanFromTaskState,
  projectSubagentSchedulerTickFromTaskState,
} from "./subagent-runtime.js";
import { TaskBoard } from "./task-board.js";

describe("subagent runtime projection", () => {
  test("projects delegation, mailbox, completion, and verification into parent-visible subagent runs", () => {
    let now = 30_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_review",
      taskId: "task-review",
      workerId: "worker-review",
      instruction: "Review the bounded AgentTool projection.",
      fromAgent: "parent-agent",
      contextSnapshot: "parentTurnId=turn-parent; isolatedContext=true; allowedTools=web.search",
      specialization: "verify",
      targetAgent: "reviewer-profile",
      verificationRequest: {
        verificationId: "verify_review",
        verifierId: "verifier-review",
        requirement: "Review result includes a concrete pass/fail verdict.",
      },
    });
    board.setDelegationStatus({
      id: "delegate_review",
      status: "completed",
      resultSummary: "Review completed with no blocking issues.",
    });
    board.upsertVerification({
      id: "verify_review",
      taskId: "task-review",
      verifierId: "verifier-review",
      verifiedBy: "verifier-review",
      requirement: "Review result includes a concrete pass/fail verdict.",
      status: "passed",
      verdict: "pass",
      verdictSummary: "Verified reviewer output.",
      checks: [
        {
          id: "summary",
          status: "pass",
          summary: "Summary is parent-visible.",
        },
      ],
    });

    const runs = projectSubagentRunsFromTaskState(board.snapshotOperations(), {
      parentTurnId: "turn-parent",
    });

    expect(runs).toEqual([
      {
        subagentId: "delegate_review",
        parentTurnId: "turn-parent",
        profileId: "reviewer-profile",
        workerId: "worker-review",
        taskId: "task-review",
        status: "completed",
        role: "verify",
        targetAgent: "reviewer-profile",
        isolatedContext: true,
        instruction: "Review the bounded AgentTool projection.",
        contextSnapshot: "parentTurnId=turn-parent; isolatedContext=true; allowedTools=web.search",
        resultSummary: "Review completed with no blocking issues.",
        createdAtMs: 30001,
        updatedAtMs: 30002,
        completedAtMs: 30002,
        verification: {
          verificationId: "verify_review",
          verifierId: "verifier-review",
          status: "passed",
          verdict: "pass",
          verdictSummary: "Verified reviewer output.",
          requirement: "Review result includes a concrete pass/fail verdict.",
          checks: [
            {
              id: "summary",
              status: "pass",
              summary: "Summary is parent-visible.",
            },
          ],
        },
        parentVisibleResult: {
          status: "completed",
          summary: "Review completed with no blocking issues.",
          verificationVerdict: "pass",
        },
      },
    ]);
  });

  test("marks parallel eligibility and write-set conflicts between active subagent runs", () => {
    let now = 40_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_scene_a",
      taskId: "task-scene-a",
      workerId: "worker-scene-a",
      instruction: "Edit the alpha scene.",
      contextSnapshot:
        "parentTurnId=turn-parallel; isolatedContext=true; parallelGroup=scene-assets; writeSet=src/scenes/alpha.ts,assets/alpha.png",
      specialization: "plan",
      targetAgent: "scene-planner-a",
    });
    board.upsertDelegation({
      id: "delegate_scene_b",
      taskId: "task-scene-b",
      workerId: "worker-scene-b",
      instruction: "Edit the same alpha scene from another branch.",
      contextSnapshot:
        "parentTurnId=turn-parallel; isolatedContext=true; parallelGroup=scene-assets; writeSet=src/scenes/alpha.ts",
      specialization: "plan",
      targetAgent: "scene-planner-b",
    });
    board.upsertDelegation({
      id: "delegate_scene_c",
      taskId: "task-scene-c",
      workerId: "worker-scene-c",
      instruction: "Edit an independent beta scene.",
      contextSnapshot:
        "parentTurnId=turn-parallel; isolatedContext=true; parallelGroup=scene-assets; writeSet=src/scenes/beta.ts",
      specialization: "plan",
      targetAgent: "scene-planner-c",
    });

    const runs = projectSubagentRunsFromTaskState(board.snapshotOperations(), {
      parentTurnId: "turn-parallel",
    });

    expect(runs.map((run) => [run.subagentId, run.scheduling])).toEqual([
      [
        "delegate_scene_a",
        {
          parallelGroup: "scene-assets",
          writeSet: ["src/scenes/alpha.ts", "assets/alpha.png"],
          canRunInParallel: false,
          conflictsWith: ["delegate_scene_b"],
          conflictReason: "write-set-overlap: src/scenes/alpha.ts",
          parallelBatch: 0,
          scheduleOrder: 0,
          readyToStart: true,
          blockedBy: [],
          writeSetSource: "explicit",
        },
      ],
      [
        "delegate_scene_b",
        {
          parallelGroup: "scene-assets",
          writeSet: ["src/scenes/alpha.ts"],
          canRunInParallel: false,
          conflictsWith: ["delegate_scene_a"],
          conflictReason: "write-set-overlap: src/scenes/alpha.ts",
          parallelBatch: 1,
          scheduleOrder: 1,
          readyToStart: false,
          blockedBy: ["delegate_scene_a"],
          writeSetSource: "explicit",
        },
      ],
      [
        "delegate_scene_c",
        {
          parallelGroup: "scene-assets",
          writeSet: ["src/scenes/beta.ts"],
          canRunInParallel: true,
          conflictsWith: [],
          parallelBatch: 0,
          scheduleOrder: 2,
          readyToStart: true,
          blockedBy: [],
          writeSetSource: "explicit",
        },
      ],
    ]);
  });

  test("projects deterministic parallel scheduler batches for active write sets", () => {
    let now = 50_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_running_alpha",
      taskId: "task-alpha-running",
      workerId: "worker-alpha-running",
      instruction: "Currently patch alpha.",
      contextSnapshot:
        "parentTurnId=turn-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-running",
    });
    board.setDelegationStatus({ id: "delegate_running_alpha", status: "running" });
    board.upsertDelegation({
      id: "delegate_beta",
      taskId: "task-beta",
      workerId: "worker-beta",
      instruction: "Patch beta independently.",
      contextSnapshot:
        "parentTurnId=turn-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      specialization: "general",
      targetAgent: "implementer-beta",
    });
    board.upsertDelegation({
      id: "delegate_alpha_followup",
      taskId: "task-alpha-followup",
      workerId: "worker-alpha-followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-followup",
    });
    board.upsertDelegation({
      id: "delegate_alpha_cleanup",
      taskId: "task-alpha-cleanup",
      workerId: "worker-alpha-cleanup",
      instruction: "Clean alpha after the follow-up.",
      contextSnapshot:
        "parentTurnId=turn-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-cleanup",
    });

    const runs = projectSubagentRunsFromTaskState(board.snapshotOperations(), {
      parentTurnId: "turn-scheduler",
    });

    expect(runs.map((run) => [run.subagentId, run.scheduling])).toEqual([
      [
        "delegate_running_alpha",
        expect.objectContaining({
          parallelGroup: "implementation",
          writeSet: ["src/alpha.ts"],
          parallelBatch: 0,
          scheduleOrder: 0,
          readyToStart: true,
          blockedBy: [],
          writeSetSource: "explicit",
        }),
      ],
      [
        "delegate_beta",
        expect.objectContaining({
          parallelGroup: "implementation",
          writeSet: ["src/beta.ts"],
          parallelBatch: 0,
          scheduleOrder: 1,
          readyToStart: true,
          blockedBy: [],
          writeSetSource: "explicit",
        }),
      ],
      [
        "delegate_alpha_followup",
        expect.objectContaining({
          parallelGroup: "implementation",
          writeSet: ["src/alpha.ts"],
          parallelBatch: 1,
          scheduleOrder: 2,
          readyToStart: false,
          blockedBy: ["delegate_running_alpha"],
          writeSetSource: "explicit",
        }),
      ],
      [
        "delegate_alpha_cleanup",
        expect.objectContaining({
          parallelGroup: "implementation",
          writeSet: ["src/alpha.ts"],
          parallelBatch: 2,
          scheduleOrder: 3,
          readyToStart: false,
          blockedBy: ["delegate_running_alpha", "delegate_alpha_followup"],
          writeSetSource: "explicit",
        }),
      ],
    ]);
  });

  test("projects inferred write sets from writable roots when explicit write set is absent", () => {
    let now = 60_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_alpha_existing",
      taskId: "task-alpha-existing",
      workerId: "worker-alpha-existing",
      instruction: "Existing alpha writer.",
      contextSnapshot:
        "parentTurnId=turn-inferred; isolatedContext=true; parallelGroup=implementation; writableRoots=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-existing",
    });
    board.upsertDelegation({
      id: "delegate_alpha_followup",
      taskId: "task-alpha-followup",
      workerId: "worker-alpha-followup",
      instruction: "Follow-up alpha writer.",
      contextSnapshot:
        "parentTurnId=turn-inferred; isolatedContext=true; parallelGroup=implementation; writableRoots=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-followup",
    });

    const runs = projectSubagentRunsFromTaskState(board.snapshotOperations(), {
      parentTurnId: "turn-inferred",
    });

    expect(runs.map((run) => [run.subagentId, run.scheduling])).toEqual([
      [
        "delegate_alpha_existing",
        {
          parallelGroup: "implementation",
          writeSet: ["src/alpha.ts"],
          writeSetSource: "inferred",
          canRunInParallel: false,
          conflictsWith: ["delegate_alpha_followup"],
          conflictReason: "write-set-overlap: src/alpha.ts",
          parallelBatch: 0,
          scheduleOrder: 0,
          readyToStart: true,
          blockedBy: [],
        },
      ],
      [
        "delegate_alpha_followup",
        {
          parallelGroup: "implementation",
          writeSet: ["src/alpha.ts"],
          writeSetSource: "inferred",
          canRunInParallel: false,
          conflictsWith: ["delegate_alpha_existing"],
          conflictReason: "write-set-overlap: src/alpha.ts",
          parallelBatch: 1,
          scheduleOrder: 1,
          readyToStart: false,
          blockedBy: ["delegate_alpha_existing"],
        },
      ],
    ]);
  });

  test("projects observed write sets from completed child result evidence", () => {
    const board = new TaskBoard();

    board.upsertDelegation({
      id: "delegate_observed_patch",
      workerId: "worker_patch",
      instruction: "Patch alpha and beta.",
      contextSnapshot:
        "parentTurnId=turn-observed; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    board.setDelegationStatus({
      id: "delegate_observed_patch",
      status: "completed",
      resultSummary: "Patched files.",
      observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
      observedWriteSetSource: "patch",
    });

    expect(projectSubagentRunsFromTaskState(board.snapshotOperations())).toContainEqual(
      expect.objectContaining({
        subagentId: "delegate_observed_patch",
        status: "completed",
        observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
        observedWriteSetSource: "patch",
        parentVisibleResult: expect.objectContaining({
          observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
          observedWriteSetSource: "patch",
        }),
      }),
    );
  });

  test("surfaces observed write-set drift against declared scheduling write sets", () => {
    const board = new TaskBoard();

    board.upsertDelegation({
      id: "delegate_alpha",
      workerId: "worker_alpha",
      instruction: "Patch alpha.",
      contextSnapshot:
        "parentTurnId=turn-observed-drift; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    board.setDelegationStatus({
      id: "delegate_alpha",
      status: "completed",
      resultSummary: "Patched alpha and beta.",
      observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
      observedWriteSetSource: "patch",
    });
    board.upsertDelegation({
      id: "delegate_beta_followup",
      workerId: "worker_beta",
      instruction: "Patch beta after alpha.",
      contextSnapshot:
        "parentTurnId=turn-observed-drift; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
    });

    const runs = projectSubagentRunsFromTaskState(board.snapshotOperations(), {
      parentTurnId: "turn-observed-drift",
    });

    expect(runs.map((run) => [run.subagentId, run.scheduling])).toEqual([
      [
        "delegate_alpha",
        expect.objectContaining({
          writeSet: ["src/alpha.ts"],
          observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
          undeclaredObservedWriteSet: ["src/beta.ts"],
          observedConflictWith: ["delegate_beta_followup"],
          conflictReason: "observed-write-set-overlap: src/beta.ts",
        }),
      ],
      [
        "delegate_beta_followup",
        expect.objectContaining({
          writeSet: ["src/beta.ts"],
          observedConflictWith: ["delegate_alpha"],
          conflictReason: "observed-write-set-overlap: src/beta.ts",
        }),
      ],
    ]);
  });

  test("projects read-only scheduler conflict recovery recommendations", () => {
    const board = new TaskBoard();

    board.upsertDelegation({
      id: "delegate_alpha_running",
      workerId: "worker_alpha_running",
      instruction: "Patch alpha first.",
      contextSnapshot:
        "parentTurnId=turn-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    board.setDelegationStatus({ id: "delegate_alpha_running", status: "running" });
    board.upsertDelegation({
      id: "delegate_alpha_followup",
      workerId: "worker_alpha_followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    board.upsertDelegation({
      id: "delegate_beta_done",
      workerId: "worker_beta_done",
      instruction: "Patch beta.",
      contextSnapshot:
        "parentTurnId=turn-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
    });
    board.setDelegationStatus({
      id: "delegate_beta_done",
      status: "completed",
      resultSummary: "Patched beta and gamma.",
      observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
      observedWriteSetSource: "patch",
    });
    board.upsertDelegation({
      id: "delegate_gamma_followup",
      workerId: "worker_gamma_followup",
      instruction: "Patch gamma after beta evidence is reviewed.",
      contextSnapshot:
        "parentTurnId=turn-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
    });

    const before = board.snapshotOperations();

    expect(
      projectSubagentSchedulerRecoveryPlanFromTaskState(before, {
        parentTurnId: "turn-recovery",
      }),
    ).toEqual({
      schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
      parentTurnId: "turn-recovery",
      canRecover: true,
      blockedSubagentIds: ["delegate_alpha_followup"],
      conflictedSubagentIds: [
        "delegate_alpha_running",
        "delegate_alpha_followup",
        "delegate_beta_done",
        "delegate_gamma_followup",
      ],
      recoveryActions: [
        {
          actionId: "recover_delegate_alpha_running_write_set_overlap",
          subagentId: "delegate_alpha_running",
          actionType: "wait-for-running-subagent",
          severity: "info",
          reason: "write-set-overlap: src/alpha.ts",
          relatedSubagentIds: ["delegate_alpha_followup"],
          writeSet: ["src/alpha.ts"],
          evidence: {
            blockedBy: [],
            conflictsWith: ["delegate_alpha_followup"],
          },
          operatorSummary:
            "Wait for running subagent delegate_alpha_running before unblocking conflicting queued work.",
        },
        {
          actionId: "recover_delegate_alpha_followup_write_set_overlap",
          subagentId: "delegate_alpha_followup",
          actionType: "wait-for-running-subagent",
          severity: "info",
          reason: "write-set-overlap: src/alpha.ts",
          relatedSubagentIds: ["delegate_alpha_running"],
          writeSet: ["src/alpha.ts"],
          evidence: {
            blockedBy: ["delegate_alpha_running"],
            conflictsWith: ["delegate_alpha_running"],
          },
          operatorSummary:
            "Wait for running subagent delegate_alpha_running before unblocking delegate_alpha_followup.",
        },
        {
          actionId: "recover_delegate_beta_done_observed_write_set_overlap",
          subagentId: "delegate_beta_done",
          actionType: "review-observed-write-set",
          severity: "warning",
          reason: "observed-write-set-overlap: src/gamma.ts",
          relatedSubagentIds: ["delegate_gamma_followup"],
          writeSet: ["src/beta.ts"],
          observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
          undeclaredObservedWriteSet: ["src/gamma.ts"],
          evidence: {
            blockedBy: [],
            conflictsWith: [],
            observedConflictWith: ["delegate_gamma_followup"],
          },
          operatorSummary:
            "Review observed write-set drift for delegate_beta_done before dispatching related subagents.",
        },
        {
          actionId: "recover_delegate_gamma_followup_observed_write_set_overlap",
          subagentId: "delegate_gamma_followup",
          actionType: "review-observed-write-set",
          severity: "warning",
          reason: "observed-write-set-overlap: src/gamma.ts",
          relatedSubagentIds: ["delegate_beta_done"],
          writeSet: ["src/gamma.ts"],
          evidence: {
            blockedBy: [],
            conflictsWith: [],
            observedConflictWith: ["delegate_beta_done"],
          },
          operatorSummary:
            "Review observed write-set drift for delegate_gamma_followup before dispatching related subagents.",
        },
      ],
      recoveryGroups: [
        {
          groupId: "recovery_group_write_set_overlap_src_alpha_ts",
          groupType: "write-set-overlap",
          severity: "info",
          reason: "write-set-overlap: src/alpha.ts",
          actionIds: [
            "recover_delegate_alpha_running_write_set_overlap",
            "recover_delegate_alpha_followup_write_set_overlap",
          ],
          subagentIds: ["delegate_alpha_running", "delegate_alpha_followup"],
          runningSubagentIds: ["delegate_alpha_running"],
          blockedSubagentIds: ["delegate_alpha_followup"],
          completedSubagentIds: [],
          writeSet: ["src/alpha.ts"],
          operatorSummary:
            "Review write-set-overlap recovery group for src/alpha.ts: 1 running, 1 blocked, 0 completed.",
        },
        {
          groupId: "recovery_group_observed_write_set_overlap_src_gamma_ts",
          groupType: "observed-write-set-overlap",
          severity: "warning",
          reason: "observed-write-set-overlap: src/gamma.ts",
          actionIds: [
            "recover_delegate_beta_done_observed_write_set_overlap",
            "recover_delegate_gamma_followup_observed_write_set_overlap",
          ],
          subagentIds: ["delegate_beta_done", "delegate_gamma_followup"],
          runningSubagentIds: [],
          blockedSubagentIds: [],
          completedSubagentIds: ["delegate_beta_done"],
          writeSet: ["src/gamma.ts"],
          observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
          undeclaredObservedWriteSet: ["src/gamma.ts"],
          operatorSummary:
            "Review observed-write-set-overlap recovery group for src/gamma.ts: 0 running, 0 blocked, 1 completed.",
        },
      ],
      recoveryOrdinal: expect.any(Number),
    });
    expect(board.snapshotOperations()).toEqual(before);
  });

  test("omits cancelled observed-drift follow-ups from scheduler recovery recommendations", () => {
    const board = new TaskBoard();

    board.upsertDelegation({
      id: "delegate_beta_done",
      workerId: "worker_beta_done",
      instruction: "Patch beta.",
      contextSnapshot:
        "parentTurnId=turn-recovery-cancelled; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
    });
    board.setDelegationStatus({
      id: "delegate_beta_done",
      status: "completed",
      resultSummary: "Patched beta and gamma.",
      observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
      observedWriteSetSource: "patch",
    });
    board.upsertDelegation({
      id: "delegate_gamma_cancelled",
      workerId: "worker_gamma",
      instruction: "Patch gamma after beta evidence is reviewed.",
      contextSnapshot:
        "parentTurnId=turn-recovery-cancelled; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
    });
    board.setDelegationStatus({
      id: "delegate_gamma_cancelled",
      status: "cancelled",
      resultSummary: "Cancelled after operator-confirmed observed write-set drift.",
    });

    expect(
      projectSubagentSchedulerRecoveryPlanFromTaskState(board.snapshotOperations(), {
        parentTurnId: "turn-recovery-cancelled",
      }),
    ).toEqual(
      expect.objectContaining({
        canRecover: false,
        blockedSubagentIds: [],
        conflictedSubagentIds: [],
        recoveryActions: [],
        recoveryGroups: [],
      }),
    );
  });

  test("projects a continuous scheduler heartbeat from task-backed subagent runs", () => {
    let now = 70_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_running_alpha",
      taskId: "task-alpha-running",
      workerId: "worker-alpha-running",
      instruction: "Currently patch alpha.",
      contextSnapshot:
        "parentTurnId=turn-heartbeat; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-running",
    });
    board.setDelegationStatus({ id: "delegate_running_alpha", status: "running" });
    board.upsertDelegation({
      id: "delegate_ready_beta",
      taskId: "task-beta-ready",
      workerId: "worker-beta",
      instruction: "Patch beta independently.",
      contextSnapshot:
        "parentTurnId=turn-heartbeat; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      specialization: "general",
      targetAgent: "implementer-beta",
    });
    board.upsertDelegation({
      id: "delegate_blocked_alpha",
      taskId: "task-alpha-blocked",
      workerId: "worker-alpha-followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-heartbeat; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-followup",
    });
    board.upsertDelegation({
      id: "delegate_unscheduled",
      taskId: "task-unscheduled",
      workerId: "worker-unscheduled",
      instruction: "Queued child without write-set evidence.",
      contextSnapshot: "parentTurnId=turn-heartbeat; isolatedContext=true",
      specialization: "general",
      targetAgent: "implementer-unscheduled",
    });

    expect(
      projectSubagentSchedulerHeartbeatFromTaskState(board.snapshotOperations(), {
        parentTurnId: "turn-heartbeat",
      }),
    ).toEqual({
      schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
      parentTurnId: "turn-heartbeat",
      totalSubagentRuns: 4,
      queuedCount: 3,
      runningCount: 1,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      schedulerTrackedCount: 3,
      readyCount: 2,
      blockedCount: 1,
      unscheduledQueuedCount: 1,
      nextReadySubagentIds: ["delegate_ready_beta", "delegate_unscheduled"],
      blockedSubagentIds: ["delegate_blocked_alpha"],
      runningSubagentIds: ["delegate_running_alpha"],
      nextParallelBatch: 0,
      canContinue: true,
      stoppedReason: "ready",
      heartbeatOrdinal: 70005,
      latestUpdatedAtMs: 70005,
    });

    const blockedOnlyBoard = new TaskBoard();
    blockedOnlyBoard.upsertDelegation({
      id: "delegate_blocking_alpha",
      workerId: "worker-alpha-running",
      instruction: "Already patching alpha.",
      contextSnapshot:
        "parentTurnId=turn-heartbeat-blocked; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    blockedOnlyBoard.setDelegationStatus({
      id: "delegate_blocking_alpha",
      status: "running",
    });
    blockedOnlyBoard.upsertDelegation({
      id: "delegate_waiting_alpha",
      workerId: "worker-alpha-followup",
      instruction: "Wait for alpha.",
      contextSnapshot:
        "parentTurnId=turn-heartbeat-blocked; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });

    expect(
      projectSubagentSchedulerHeartbeatFromTaskState(blockedOnlyBoard.snapshotOperations(), {
        parentTurnId: "turn-heartbeat-blocked",
      }),
    ).toEqual(
      expect.objectContaining({
        canContinue: false,
        stoppedReason: "scheduler-blocked",
        nextReadySubagentIds: [],
        blockedSubagentIds: ["delegate_waiting_alpha"],
        runningSubagentIds: ["delegate_blocking_alpha"],
      }),
    );
  });

  test("projects a read-only scheduler dispatch plan from ready queued subagent runs", () => {
    let now = 80_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_running_alpha",
      taskId: "task-alpha-running",
      workerId: "worker-alpha-running",
      instruction: "Currently patch alpha.",
      contextSnapshot:
        "parentTurnId=turn-dispatch; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-running",
    });
    board.setDelegationStatus({ id: "delegate_running_alpha", status: "running" });
    board.upsertDelegation({
      id: "delegate_ready_beta",
      taskId: "task-beta-ready",
      workerId: "worker-beta",
      instruction: "Patch beta independently.",
      contextSnapshot:
        "parentTurnId=turn-dispatch; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      specialization: "general",
      targetAgent: "implementer-beta",
    });
    board.upsertDelegation({
      id: "delegate_ready_unscheduled",
      taskId: "task-unscheduled-ready",
      workerId: "worker-unscheduled",
      instruction: "Queued child without write-set evidence.",
      contextSnapshot: "parentTurnId=turn-dispatch; isolatedContext=true",
      specialization: "general",
      targetAgent: "implementer-unscheduled",
    });
    board.upsertDelegation({
      id: "delegate_blocked_alpha",
      taskId: "task-alpha-blocked",
      workerId: "worker-alpha-followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-dispatch; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      specialization: "general",
      targetAgent: "implementer-alpha-followup",
    });

    expect(
      projectSubagentSchedulerDispatchPlanFromTaskState(board.snapshotOperations(), {
        parentTurnId: "turn-dispatch",
      }),
    ).toEqual({
      schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
      parentTurnId: "turn-dispatch",
      planOrdinal: 80005,
      heartbeatOrdinal: 80005,
      canDispatch: true,
      dispatchReason: "ready",
      maxDispatchableCount: 2,
      dispatchableSubagentIds: ["delegate_ready_beta", "delegate_ready_unscheduled"],
      dispatchBatches: [
        {
          parallelBatch: 0,
          subagentIds: ["delegate_ready_beta", "delegate_ready_unscheduled"],
          workerIds: ["worker-beta", "worker-unscheduled"],
          writeSets: [
            {
              subagentId: "delegate_ready_beta",
              writeSet: ["src/beta.ts"],
              writeSetSource: "explicit",
            },
            {
              subagentId: "delegate_ready_unscheduled",
              writeSet: [],
            },
          ],
        },
      ],
      blockedSubagentIds: ["delegate_blocked_alpha"],
      runningSubagentIds: ["delegate_running_alpha"],
    });
  });

  test("projects read-only scheduler tick intents from the shared task-backed runtime", () => {
    let now = 90_000;
    const board = new TaskBoard(undefined, {
      now: () => {
        now += 1;
        return now;
      },
    });

    board.upsertDelegation({
      id: "delegate_running_alpha",
      taskId: "task-alpha-running",
      workerId: "worker-alpha-running",
      instruction: "Currently patch alpha.",
      contextSnapshot:
        "parentTurnId=turn-tick; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });
    board.setDelegationStatus({ id: "delegate_running_alpha", status: "running" });
    board.upsertDelegation({
      id: "delegate_ready_beta",
      taskId: "task-beta-ready",
      workerId: "worker-beta",
      instruction: "Patch beta independently.",
      contextSnapshot:
        "parentTurnId=turn-tick; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
    });
    board.upsertDelegation({
      id: "delegate_ready_gamma",
      taskId: "task-gamma-ready",
      workerId: "worker-gamma",
      instruction: "Patch gamma independently.",
      contextSnapshot:
        "parentTurnId=turn-tick; isolatedContext=true; parallelGroup=implementation; writableRoots=src/gamma.ts",
    });
    board.upsertDelegation({
      id: "delegate_blocked_alpha",
      taskId: "task-alpha-blocked",
      workerId: "worker-alpha-followup",
      instruction: "Patch alpha after the running child.",
      contextSnapshot:
        "parentTurnId=turn-tick; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
    });

    const before = board.snapshotOperations();

    expect(
      projectSubagentSchedulerTickFromTaskState(before, {
        sessionId: "session-tick",
        latestTurnId: "turn-tick",
        parentTurnId: "turn-tick",
      }),
    ).toEqual({
      schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
      sessionId: "session-tick",
      latestTurnId: "turn-tick",
      dispatchPlan: {
        schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
        parentTurnId: "turn-tick",
        planOrdinal: 90005,
        heartbeatOrdinal: 90005,
        canDispatch: true,
        dispatchReason: "ready",
        maxDispatchableCount: 2,
        dispatchableSubagentIds: ["delegate_ready_beta", "delegate_ready_gamma"],
        dispatchBatches: [
          {
            parallelBatch: 0,
            subagentIds: ["delegate_ready_beta", "delegate_ready_gamma"],
            workerIds: ["worker-beta", "worker-gamma"],
            writeSets: [
              {
                subagentId: "delegate_ready_beta",
                writeSet: ["src/beta.ts"],
                writeSetSource: "explicit",
              },
              {
                subagentId: "delegate_ready_gamma",
                writeSet: ["src/gamma.ts"],
                writeSetSource: "inferred",
              },
            ],
          },
        ],
        blockedSubagentIds: ["delegate_blocked_alpha"],
        runningSubagentIds: ["delegate_running_alpha"],
      },
      dispatchIntents: [
        {
          intentId: "dispatch_delegate_ready_beta",
          delegationId: "delegate_ready_beta",
          workerId: "worker-beta",
          command: "run-delegation",
          argv: [
            "run-delegation",
            "--session-id",
            "session-tick",
            "--worker-id",
            "worker-beta",
            "--delegation-id",
            "delegate_ready_beta",
          ],
          parallelBatch: 0,
          writeSet: ["src/beta.ts"],
          writeSetSource: "explicit",
        },
        {
          intentId: "dispatch_delegate_ready_gamma",
          delegationId: "delegate_ready_gamma",
          workerId: "worker-gamma",
          command: "run-delegation",
          argv: [
            "run-delegation",
            "--session-id",
            "session-tick",
            "--worker-id",
            "worker-gamma",
            "--delegation-id",
            "delegate_ready_gamma",
          ],
          parallelBatch: 0,
          writeSet: ["src/gamma.ts"],
          writeSetSource: "inferred",
        },
      ],
      claimDryRun: true,
    });
    expect(board.snapshotOperations()).toEqual(before);
  });
});
