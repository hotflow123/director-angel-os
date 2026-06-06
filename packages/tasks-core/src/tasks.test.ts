import { describe, expect, test } from "vitest";

import { deriveTaskLifecycle, summarizeTaskLifecycle } from "./tasks.js";

describe("task lifecycle projection", () => {
  test("derives fallback lifecycle directly from todo items", () => {
    const lifecycle = deriveTaskLifecycle({
      todos: {
        items: [
          { id: "todo_pending", content: "Pending task", status: "todo" },
          { id: "todo_running", content: "Running task", status: "doing" },
          { id: "todo_done", content: "Done task", status: "done" },
        ],
      },
      delegation: [],
      verification: [],
    });

    expect(lifecycle).toEqual([
      {
        taskId: "todo_pending",
        title: "Pending task",
        status: "pending",
        todoStatus: "todo",
      },
      {
        taskId: "todo_running",
        title: "Running task",
        status: "running",
        todoStatus: "doing",
      },
      {
        taskId: "todo_done",
        title: "Done task",
        status: "done",
        todoStatus: "done",
      },
    ]);
  });

  test("derives delegation-backed lifecycle states and titles", () => {
    const lifecycle = deriveTaskLifecycle({
      todos: { items: [] },
      delegation: [
        {
          id: "d_queued",
          taskId: "task_queued",
          workerId: "worker-a",
          instruction: "Queued delegation",
          status: "queued",
          createdAtMs: 10,
          updatedAtMs: 10,
        },
        {
          id: "d_running",
          taskId: "task_running",
          workerId: "worker-b",
          instruction: "Running delegation",
          status: "running",
          createdAtMs: 20,
          updatedAtMs: 20,
        },
        {
          id: "d_done",
          taskId: "task_done",
          workerId: "worker-c",
          instruction: "Completed delegation",
          status: "completed",
          createdAtMs: 30,
          updatedAtMs: 30,
          completedAtMs: 30,
        },
        {
          id: "d_failed",
          taskId: "task_failed",
          workerId: "worker-d",
          instruction: "Failed delegation",
          status: "failed",
          createdAtMs: 40,
          updatedAtMs: 40,
          completedAtMs: 40,
          error: "network timeout",
        },
      ],
      verification: [],
    });

    expect(lifecycle).toEqual([
      {
        taskId: "task_queued",
        title: "Queued delegation",
        status: "delegated",
        assignedAgent: "worker-a",
        latestDelegationId: "d_queued",
      },
      {
        taskId: "task_running",
        title: "Running delegation",
        status: "running",
        assignedAgent: "worker-b",
        latestDelegationId: "d_running",
      },
      {
        taskId: "task_done",
        title: "Completed delegation",
        status: "done",
        assignedAgent: "worker-c",
        latestDelegationId: "d_done",
      },
      {
        taskId: "task_failed",
        title: "Failed delegation",
        status: "failed",
        assignedAgent: "worker-d",
        latestDelegationId: "d_failed",
      },
    ]);
  });

  test("lets terminal verification own lifecycle when it is the latest record", () => {
    const lifecycle = deriveTaskLifecycle({
      todos: {
        items: [
          { id: "task_verified", content: "Verified task", status: "todo" },
          { id: "task_blocked", content: "Blocked task", status: "todo" },
          { id: "task_failed", content: "Failed task", status: "todo" },
        ],
      },
      delegation: [
        {
          id: "d_verified",
          taskId: "task_verified",
          workerId: "worker-a",
          instruction: "Implement verified task",
          status: "completed",
          createdAtMs: 10,
          updatedAtMs: 20,
          completedAtMs: 20,
        },
        {
          id: "d_blocked",
          taskId: "task_blocked",
          workerId: "worker-b",
          instruction: "Implement blocked task",
          status: "completed",
          createdAtMs: 30,
          updatedAtMs: 40,
          completedAtMs: 40,
        },
        {
          id: "d_failed",
          taskId: "task_failed",
          workerId: "worker-c",
          instruction: "Implement failed task",
          status: "completed",
          createdAtMs: 50,
          updatedAtMs: 60,
          completedAtMs: 60,
        },
      ],
      verification: [
        {
          id: "v_verified",
          taskId: "task_verified",
          verifierId: "verify-a",
          requirement: "verified task passes",
          status: "passed",
          verdict: "pass",
          createdAtMs: 21,
          updatedAtMs: 21,
        },
        {
          id: "v_blocked",
          taskId: "task_blocked",
          verifierId: "verify-b",
          requirement: "blocked task still needs review",
          status: "partial",
          verdict: "partial",
          createdAtMs: 41,
          updatedAtMs: 41,
        },
        {
          id: "v_failed",
          taskId: "task_failed",
          verifierId: "verify-c",
          requirement: "failed task regressed",
          status: "failed",
          verdict: "fail",
          createdAtMs: 61,
          updatedAtMs: 61,
        },
      ],
    });

    expect(
      lifecycle.map((entry) => [entry.taskId, entry.status, entry.verificationVerdict]),
    ).toEqual([
      ["task_verified", "verified", "pass"],
      ["task_blocked", "blocked", "partial"],
      ["task_failed", "failed", "fail"],
    ]);

    expect(summarizeTaskLifecycle(lifecycle)).toEqual({
      total: 3,
      byStatus: {
        pending: 0,
        delegated: 0,
        running: 0,
        blocked: 1,
        done: 0,
        failed: 1,
        verified: 1,
      },
    });
  });

  test("uses delegation targetAgent then specialization before workerId for lifecycle assignment", () => {
    const lifecycle = deriveTaskLifecycle({
      todos: { items: [] },
      delegation: [
        {
          id: "d_target",
          taskId: "task_target",
          workerId: "worker-route",
          specialization: "plan",
          targetAgent: "plan-agent",
          instruction: "Plan the production slice",
          status: "queued",
          createdAtMs: 10,
          updatedAtMs: 10,
        },
        {
          id: "d_specialization",
          taskId: "task_specialization",
          workerId: "worker-route",
          specialization: "verify",
          instruction: "Verify the production slice",
          status: "queued",
          createdAtMs: 20,
          updatedAtMs: 20,
        },
        {
          id: "d_worker",
          taskId: "task_worker",
          workerId: "worker-route",
          instruction: "Run the production slice",
          status: "queued",
          createdAtMs: 30,
          updatedAtMs: 30,
        },
      ],
      verification: [],
    });

    expect(lifecycle.map((entry) => [entry.taskId, entry.assignedAgent])).toEqual([
      ["task_target", "plan-agent"],
      ["task_specialization", "verify"],
      ["task_worker", "worker-route"],
    ]);
  });

  test("ignores stale verification when a newer delegation restarts the task", () => {
    const lifecycle = deriveTaskLifecycle({
      todos: {
        items: [{ id: "task_restart", content: "Restarted task", status: "todo" }],
      },
      delegation: [
        {
          id: "d_old",
          taskId: "task_restart",
          workerId: "worker-a",
          instruction: "Initial implementation",
          status: "completed",
          createdAtMs: 10,
          updatedAtMs: 20,
          completedAtMs: 20,
        },
        {
          id: "d_new",
          taskId: "task_restart",
          workerId: "worker-b",
          instruction: "Retry implementation",
          status: "queued",
          createdAtMs: 40,
          updatedAtMs: 40,
        },
      ],
      verification: [
        {
          id: "v_old",
          taskId: "task_restart",
          verifierId: "verify-a",
          requirement: "initial implementation passed",
          status: "passed",
          verdict: "pass",
          createdAtMs: 30,
          updatedAtMs: 30,
        },
      ],
    });

    expect(lifecycle).toEqual([
      {
        taskId: "task_restart",
        title: "Restarted task",
        status: "delegated",
        todoStatus: "todo",
        assignedAgent: "worker-b",
        verificationVerdict: "pass",
        latestDelegationId: "d_new",
        latestVerificationId: "v_old",
      },
    ]);
  });
});
