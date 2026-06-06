import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { SessionStoreTaskPlanePort, projectSessionTaskState } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { runWorkerJobsCli } from "../src/main.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function createWorkerJobsEnv() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-worker-flow-"));
  cleanupPaths.push(workspaceRoot);

  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  const dbPath = join(dataDir, "sessions", "worker.sqlite");

  return {
    dbPath,
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_WORKER_SESSION_DB_PATH: dbPath,
    },
  };
}

function writeMinimalGitIndex(workspaceRoot: string, paths: readonly string[]): void {
  const entries = paths.map((path) => createGitIndexEntry(workspaceRoot, path));
  const header = Buffer.alloc(12);
  header.write("DIRC", 0, "ascii");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const body = Buffer.concat(entries);
  mkdirSync(join(workspaceRoot, ".git"), { recursive: true });
  writeFileSync(join(workspaceRoot, ".git", "index"), Buffer.concat([header, body]));
}

function createGitIndexEntry(workspaceRoot: string, path: string): Buffer {
  const stat = statSync(join(workspaceRoot, path));
  const mtimeSeconds = Math.floor(stat.mtimeMs / 1000);
  const mtimeNanoseconds = Math.floor(stat.mtimeMs * 1_000_000) % 1_000_000_000;
  const pathBuffer = Buffer.from(path);
  const entryLength = 62 + pathBuffer.length + 1;
  const paddedLength = Math.ceil(entryLength / 8) * 8;
  const entry = Buffer.alloc(paddedLength);
  entry.writeUInt32BE(mtimeSeconds, 8);
  entry.writeUInt32BE(mtimeNanoseconds, 12);
  entry.writeUInt32BE(1, 16);
  entry.writeUInt32BE(1, 20);
  entry.writeUInt32BE(0o100644, 24);
  entry.writeUInt32BE(1000, 28);
  entry.writeUInt32BE(1000, 32);
  entry.writeUInt32BE(stat.size, 36);
  entry.writeUInt16BE(pathBuffer.length, 60);
  pathBuffer.copy(entry, 62);
  return entry;
}

describe("worker-jobs delegation and verification flow", () => {
  test("consumes queued delegation and then passes verification", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave12_success";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d1",
        taskId: "todo_1",
        workerId: "worker-a",
        instruction: "Implement the bounded delegation flow.",
        fromAgent: "director",
        contextSnapshot: "goal=bounded delegation flow; files=tasks-core,worker-jobs",
        specialization: "plan",
        targetAgent: "plan-agent",
        verificationRequest: {
          verificationId: "v1",
          verifierId: "verifier-a",
          requirement: "bounded delegation flow passes",
        },
      });
    } finally {
      seedStore.close();
    }

    let mailboxStdout = "";
    let mailboxStderr = "";
    const mailboxExitCode = await runWorkerJobsCli(
      ["mailbox-list", "--session-id", sessionId, "--worker-id", "worker-a"],
      {
        env,
        io: {
          stdout(message) {
            mailboxStdout += message;
          },
          stderr(message) {
            mailboxStderr += message;
          },
        },
      },
    );

    expect(mailboxExitCode).toBe(0);
    expect(mailboxStderr).toBe("");
    expect(JSON.parse(mailboxStdout)).toMatchObject({
      status: "ok",
      sessionId,
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
          instruction: "Implement the bounded delegation flow.",
          status: "queued",
          taskId: "todo_1",
          specialization: "plan",
          targetAgent: "plan-agent",
          verificationRequest: {
            verificationId: "v1",
            verifierId: "verifier-a",
            requirement: "bounded delegation flow passes",
          },
          notificationId: "notification_delegation_d1",
          notificationStatus: "pending",
          notificationSummary: "Delegation d1 is queued for worker worker-a.",
        },
      ],
      notifications: [
        {
          id: "notification_delegation_d1",
          kind: "delegation_assigned",
          status: "pending",
          recipientId: "worker-a",
          summary: "Delegation d1 is queued for worker worker-a.",
          taskId: "todo_1",
          delegationId: "d1",
        },
      ],
    });

    let delegationStdout = "";
    let delegationStderr = "";
    const delegationExitCode = await runWorkerJobsCli(
      ["run-delegation", "--session-id", sessionId, "--worker-id", "worker-a"],
      {
        env,
        io: {
          stdout(message) {
            delegationStdout += message;
          },
          stderr(message) {
            delegationStderr += message;
          },
        },
      },
    );

    expect(delegationExitCode).toBe(0);
    expect(delegationStderr).toBe("");
    expect(JSON.parse(delegationStdout)).toMatchObject({
      status: "ok",
      delegationId: "d1",
      specialization: "plan",
      targetAgent: "plan-agent",
      finalDelegationStatus: "completed",
      verificationId: "v1",
      verificationStatus: "pending",
      verificationSource: "delegation",
      initialDelegationMailboxSize: 1,
      remainingDelegationMailboxSize: 0,
      pendingVerificationMailboxSize: 1,
      subagentRun: {
        subagentId: "d1",
        parentTurnId: "unknown",
        profileId: "plan-agent",
        workerId: "worker-a",
        taskId: "todo_1",
        status: "completed",
        role: "plan",
        targetAgent: "plan-agent",
        isolatedContext: true,
        instruction: "Implement the bounded delegation flow.",
        contextSnapshot: "goal=bounded delegation flow; files=tasks-core,worker-jobs",
        resultSummary: "Delegation d1 completed by worker worker-a.",
        verification: {
          verificationId: "v1",
          verifierId: "verifier-a",
          status: "pending",
          requirement: "bounded delegation flow passes",
        },
        parentVisibleResult: {
          status: "completed",
          summary: "Delegation d1 completed by worker worker-a.",
        },
      },
    });

    let verifierMailboxStdout = "";
    let verifierMailboxStderr = "";
    const verifierMailboxExitCode = await runWorkerJobsCli(
      ["verifier-mailbox-list", "--session-id", sessionId, "--verifier-id", "verifier-a"],
      {
        env,
        io: {
          stdout(message) {
            verifierMailboxStdout += message;
          },
          stderr(message) {
            verifierMailboxStderr += message;
          },
        },
      },
    );

    expect(verifierMailboxExitCode).toBe(0);
    expect(verifierMailboxStderr).toBe("");
    expect(JSON.parse(verifierMailboxStdout)).toMatchObject({
      status: "ok",
      sessionId,
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
          requirement: "bounded delegation flow passes",
          status: "pending",
          taskId: "todo_1",
          notificationId: "notification_verification_v1",
          notificationStatus: "pending",
          notificationSummary: "Verification v1 is pending for verifier verifier-a.",
        },
      ],
      notifications: [
        {
          id: "notification_verification_v1",
          kind: "verification_requested",
          status: "pending",
          recipientId: "verifier-a",
          summary: "Verification v1 is pending for verifier verifier-a.",
          taskId: "todo_1",
          verificationId: "v1",
        },
      ],
    });

    let verificationStdout = "";
    let verificationStderr = "";
    const verificationExitCode = await runWorkerJobsCli(
      [
        "run-verification",
        "--session-id",
        sessionId,
        "--verifier-id",
        "verifier-a",
        "--verification-id",
        "v1",
        "--status",
        "passed",
        "--verdict",
        "Looks good.",
      ],
      {
        env,
        io: {
          stdout(message) {
            verificationStdout += message;
          },
          stderr(message) {
            verificationStderr += message;
          },
        },
      },
    );

    expect(verificationExitCode).toBe(0);
    expect(verificationStderr).toBe("");
    expect(JSON.parse(verificationStdout)).toMatchObject({
      status: "ok",
      verificationId: "v1",
      finalVerificationStatus: "passed",
      verdict: "pass",
      verdictSummary: "Looks good.",
      verifiedBy: "verifier-a",
      checks: [
        {
          id: "requirement",
          status: "pass",
          summary: "bounded delegation flow passes",
          detail: "Looks good.",
        },
      ],
      initialVerificationMailboxSize: 1,
      remainingVerificationMailboxSize: 0,
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d1",
        status: "completed",
        workerId: "worker-a",
        fromAgent: "director",
        contextSnapshot: "goal=bounded delegation flow; files=tasks-core,worker-jobs",
        specialization: "plan",
        targetAgent: "plan-agent",
        verificationRequest: {
          verificationId: "v1",
          verifierId: "verifier-a",
          requirement: "bounded delegation flow passes",
        },
        resultSummary: "Delegation d1 completed by worker worker-a.",
      });
      expect(taskState.verification[0]).toMatchObject({
        id: "v1",
        status: "passed",
        verifierId: "verifier-a",
        verifiedBy: "verifier-a",
        verdict: "pass",
        verdictSummary: "Looks good.",
        checks: [
          {
            id: "requirement",
            status: "pass",
            summary: "bounded delegation flow passes",
            detail: "Looks good.",
          },
        ],
      });
      expect(taskState.notifications).toEqual([
        {
          id: "notification_delegation_d1",
          kind: "delegation_assigned",
          recipientKind: "worker",
          recipientId: "worker-a",
          status: "acknowledged",
          summary: "Delegation d1 is queued for worker worker-a.",
          taskId: "todo_1",
          delegationId: "d1",
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
          acknowledgedAtMs: expect.any(Number),
        },
        {
          id: "notification_verification_v1",
          kind: "verification_requested",
          recipientKind: "verifier",
          recipientId: "verifier-a",
          status: "acknowledged",
          summary: "Verification v1 is pending for verifier verifier-a.",
          taskId: "todo_1",
          verificationId: "v1",
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
          acknowledgedAtMs: expect.any(Number),
        },
      ]);
      expect(taskState.lifecycle).toEqual([
        {
          taskId: "todo_1",
          title: "Implement the bounded delegation flow.",
          status: "verified",
          assignedAgent: "plan-agent",
          verificationVerdict: "pass",
          latestDelegationId: "d1",
          latestVerificationId: "v1",
        },
      ]);
    } finally {
      resultStore.close();
    }
  });

  test("run-delegation skips scheduler-blocked queued children and claims the ready child", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f8_scheduler_claim";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_running",
        workerId: "worker-a",
        instruction: "Patch alpha first.",
        contextSnapshot:
          "parentTurnId=turn-f8-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_running",
        status: "running",
      });
      await taskPlane.enqueueDelegation({
        id: "d_blocked",
        workerId: "worker-a",
        instruction: "Patch alpha after running child.",
        contextSnapshot:
          "parentTurnId=turn-f8-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready",
        workerId: "worker-a",
        instruction: "Patch beta independently.",
        contextSnapshot:
          "parentTurnId=turn-f8-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-delegation", "--session-id", sessionId, "--worker-id", "worker-a"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_ready",
      skippedSchedulerBlockedDelegationIds: ["d_blocked"],
      scheduler: {
        readyToStart: true,
        parallelBatch: 0,
        writeSet: ["src/beta.ts"],
      },
      subagentRun: {
        subagentId: "d_ready",
        status: "completed",
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_blocked")?.status).toBe("queued");
      expect(taskState.delegation.find((entry) => entry.id === "d_ready")?.status).toBe(
        "completed",
      );
    } finally {
      resultStore.close();
    }
  });

  test("run-delegation bounded scheduler loop consumes multiple ready children before blocked child", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f9_scheduler_loop";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_running",
        workerId: "worker-a",
        instruction: "Patch alpha first.",
        contextSnapshot:
          "parentTurnId=turn-f9-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_running",
        status: "running",
      });
      await taskPlane.enqueueDelegation({
        id: "d_blocked",
        workerId: "worker-a",
        instruction: "Patch alpha after running child.",
        contextSnapshot:
          "parentTurnId=turn-f9-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_beta",
        workerId: "worker-a",
        instruction: "Patch beta independently.",
        contextSnapshot:
          "parentTurnId=turn-f9-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_gamma",
        workerId: "worker-a",
        instruction: "Patch gamma independently.",
        contextSnapshot:
          "parentTurnId=turn-f9-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-delegation", "--session-id", sessionId, "--worker-id", "worker-a", "--max-claims", "2"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_ready_beta",
      claimedDelegationIds: ["d_ready_beta", "d_ready_gamma"],
      finalDelegationStatuses: ["completed", "completed"],
      skippedSchedulerBlockedDelegationIds: ["d_blocked"],
      schedulerLoop: {
        maxClaims: 2,
        claimedCount: 2,
        stoppedReason: "max-claims",
      },
      schedulerHeartbeat: {
        schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
        totalSubagentRuns: 4,
        queuedCount: 1,
        runningCount: 1,
        completedCount: 2,
        failedCount: 0,
        cancelledCount: 0,
        schedulerTrackedCount: 2,
        readyCount: 0,
        blockedCount: 1,
        unscheduledQueuedCount: 0,
        nextReadySubagentIds: [],
        blockedSubagentIds: ["d_blocked"],
        runningSubagentIds: ["d_running"],
        canContinue: false,
        stoppedReason: "scheduler-blocked",
        heartbeatOrdinal: expect.any(Number),
        latestUpdatedAtMs: expect.any(Number),
      },
      schedulerDispatchPlan: {
        schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
        planOrdinal: expect.any(Number),
        heartbeatOrdinal: expect.any(Number),
        canDispatch: false,
        dispatchReason: "scheduler-blocked",
        maxDispatchableCount: 0,
        dispatchableSubagentIds: [],
        dispatchBatches: [],
        blockedSubagentIds: ["d_blocked"],
        runningSubagentIds: ["d_running"],
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_beta")?.status).toBe(
        "completed",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_gamma")?.status).toBe(
        "completed",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_blocked")?.status).toBe("queued");
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-tick projects dispatch intents without claiming queued children", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f15_scheduler_tick";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_running",
        workerId: "worker-a",
        instruction: "Patch alpha first.",
        contextSnapshot:
          "parentTurnId=turn-f15-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_running",
        status: "running",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_beta",
        workerId: "worker-a",
        instruction: "Patch beta independently.",
        contextSnapshot:
          "parentTurnId=turn-f15-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_gamma",
        workerId: "worker-b",
        instruction: "Patch gamma independently.",
        contextSnapshot:
          "parentTurnId=turn-f15-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_blocked_alpha",
        workerId: "worker-a",
        instruction: "Patch alpha after running child.",
        contextSnapshot:
          "parentTurnId=turn-f15-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(["scheduler-tick", "--session-id", sessionId], {
      env,
      io: {
        stdout(message) {
          stdout += message;
        },
        stderr(message) {
          stderr += message;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
      dispatchPlan: {
        schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
        canDispatch: true,
        maxDispatchableCount: 2,
        dispatchableSubagentIds: ["d_ready_beta", "d_ready_gamma"],
        blockedSubagentIds: ["d_blocked_alpha"],
        runningSubagentIds: ["d_running"],
      },
      dispatchIntents: [
        {
          intentId: "dispatch_d_ready_beta",
          delegationId: "d_ready_beta",
          workerId: "worker-a",
          command: "run-delegation",
          argv: [
            "run-delegation",
            "--session-id",
            sessionId,
            "--worker-id",
            "worker-a",
            "--delegation-id",
            "d_ready_beta",
          ],
          parallelBatch: 0,
          writeSet: ["src/beta.ts"],
          writeSetSource: "explicit",
        },
        {
          intentId: "dispatch_d_ready_gamma",
          delegationId: "d_ready_gamma",
          workerId: "worker-b",
          command: "run-delegation",
          argv: [
            "run-delegation",
            "--session-id",
            sessionId,
            "--worker-id",
            "worker-b",
            "--delegation-id",
            "d_ready_gamma",
          ],
          parallelBatch: 0,
          writeSet: ["src/gamma.ts"],
          writeSetSource: "explicit",
        },
      ],
      claimDryRun: true,
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_beta")?.status).toBe(
        "queued",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_gamma")?.status).toBe(
        "queued",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_blocked_alpha")?.status).toBe(
        "queued",
      );
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-executor consumes bounded dispatch intents from scheduler tick", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_fnext_scheduler_executor";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_beta",
        workerId: "worker-a",
        instruction: "Patch beta independently.",
        contextSnapshot:
          "parentTurnId=turn-fnext-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_gamma",
        workerId: "worker-b",
        instruction: "Patch gamma independently.",
        contextSnapshot:
          "parentTurnId=turn-fnext-scheduler; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["scheduler-executor", "--session-id", sessionId, "--max-dispatches", "2"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      executorMode: "bounded-local",
      startupReconciliation: {
        reconciledDelegationIds: [],
        runningDelegationTargetStatus: "failed",
      },
      maxDispatches: 2,
      executedCount: 2,
      stoppedReason: "max-dispatches",
      executedDispatchIntents: [
        {
          intentId: "dispatch_d_ready_beta",
          delegationId: "d_ready_beta",
          workerId: "worker-a",
          parallelBatch: 0,
          writeSet: ["src/beta.ts"],
        },
        {
          intentId: "dispatch_d_ready_gamma",
          delegationId: "d_ready_gamma",
          workerId: "worker-b",
          parallelBatch: 0,
          writeSet: ["src/gamma.ts"],
        },
      ],
      skippedDispatchIntentIds: [],
      dispatchReports: [
        {
          delegationId: "d_ready_beta",
          finalDelegationStatus: "completed",
          schedulerLoop: {
            maxClaims: 1,
            claimedCount: 1,
          },
        },
        {
          delegationId: "d_ready_gamma",
          finalDelegationStatus: "completed",
          schedulerLoop: {
            maxClaims: 1,
            claimedCount: 1,
          },
        },
      ],
      finalSchedulerTick: {
        schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
        dispatchPlan: {
          canDispatch: false,
          dispatchableSubagentIds: [],
          blockedSubagentIds: [],
          runningSubagentIds: [],
        },
        dispatchIntents: [],
        claimDryRun: true,
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_beta")?.status).toBe(
        "completed",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_gamma")?.status).toBe(
        "completed",
      );
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-executor fails orphaned running delegation before dispatching ready children", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_u3_scheduler_executor_orphaned_running";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_orphaned_alpha",
        workerId: "worker-alpha",
        instruction: "Patch alpha before the worker process vanished.",
        contextSnapshot:
          "parentTurnId=turn-u3-orphaned; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_orphaned_alpha",
        status: "running",
      });
      await taskPlane.enqueueDelegation({
        id: "d_after_alpha",
        workerId: "worker-alpha-followup",
        instruction: "Patch alpha after orphan recovery.",
        contextSnapshot:
          "parentTurnId=turn-u3-orphaned; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.enqueueDelegation({
        id: "d_ready_beta",
        workerId: "worker-beta",
        instruction: "Patch beta independently.",
        contextSnapshot:
          "parentTurnId=turn-u3-orphaned; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["scheduler-executor", "--session-id", sessionId, "--max-dispatches", "2"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      startupReconciliation: {
        reconciledDelegationIds: ["d_orphaned_alpha"],
        runningDelegationTargetStatus: "failed",
      },
      initialSchedulerTick: {
        dispatchPlan: {
          canDispatch: true,
          dispatchableSubagentIds: ["d_after_alpha", "d_ready_beta"],
          blockedSubagentIds: [],
          runningSubagentIds: [],
        },
      },
      executedDispatchIntents: [
        expect.objectContaining({
          delegationId: "d_after_alpha",
          workerId: "worker-alpha-followup",
          writeSet: ["src/alpha.ts"],
        }),
        expect.objectContaining({
          delegationId: "d_ready_beta",
          workerId: "worker-beta",
          writeSet: ["src/beta.ts"],
        }),
      ],
      finalSchedulerTick: {
        dispatchPlan: {
          canDispatch: false,
          blockedSubagentIds: [],
          runningSubagentIds: [],
        },
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_orphaned_alpha")).toMatchObject({
        status: "failed",
        error: "Recovered orphaned running subagent delegation before scheduler execution.",
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_after_alpha")?.status).toBe(
        "completed",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_ready_beta")?.status).toBe(
        "completed",
      );
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-recovery keeps running conflicts blocked and requires confirmation for observed drift", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_fnext_recovery_requires_confirmation";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_beta_done",
        workerId: "worker-beta",
        instruction: "Patch beta.",
        contextSnapshot:
          "parentTurnId=turn-fnext-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_beta_done",
        status: "completed",
        resultSummary: "Patched beta and gamma.",
        observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
        observedWriteSetSource: "patch",
      });
      await taskPlane.enqueueDelegation({
        id: "d_gamma_followup",
        workerId: "worker-gamma",
        instruction: "Patch gamma after beta evidence is reviewed.",
        contextSnapshot:
          "parentTurnId=turn-fnext-recovery; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(["scheduler-recovery", "--session-id", sessionId], {
      env,
      io: {
        stdout(message) {
          stdout += message;
        },
        stderr(message) {
          stderr += message;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      workflowMode: "bounded-local-recovery",
      startupReconciliation: {
        reconciledDelegationIds: [],
        runningDelegationTargetStatus: "failed",
      },
      dryRun: true,
      cancelledDelegationIds: [],
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          actionId: "recover_d_beta_done_observed_write_set_overlap",
          actionType: "review-observed-write-set",
          result: "requires-confirmation",
          mutation: "none",
          confirmationRequired: true,
          queuedDelegationIds: ["d_gamma_followup"],
          cancelledDelegationIds: [],
        }),
      ]),
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_gamma_followup")?.status).toBe(
        "queued",
      );
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-recovery fails orphaned running delegation before projecting recovery actions", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_u3_recovery_orphaned_running";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_orphaned_alpha",
        workerId: "worker-alpha",
        instruction: "Patch alpha before the worker process vanished.",
        contextSnapshot:
          "parentTurnId=turn-u3-recovery-orphaned; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_orphaned_alpha",
        status: "running",
      });
      await taskPlane.enqueueDelegation({
        id: "d_after_alpha",
        workerId: "worker-alpha-followup",
        instruction: "Patch alpha after orphan recovery.",
        contextSnapshot:
          "parentTurnId=turn-u3-recovery-orphaned; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(["scheduler-recovery", "--session-id", sessionId], {
      env,
      io: {
        stdout(message) {
          stdout += message;
        },
        stderr(message) {
          stderr += message;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      startupReconciliation: {
        reconciledDelegationIds: ["d_orphaned_alpha"],
        runningDelegationTargetStatus: "failed",
      },
      initialRecoveryPlan: {
        canRecover: false,
        blockedSubagentIds: [],
        conflictedSubagentIds: [],
        recoveryActions: [],
      },
      actionResults: [],
      finalRecoveryPlan: {
        canRecover: false,
        recoveryActions: [],
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_orphaned_alpha")).toMatchObject({
        status: "failed",
        error: "Recovered orphaned running subagent delegation before scheduler recovery.",
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_after_alpha")?.status).toBe(
        "queued",
      );
    } finally {
      resultStore.close();
    }
  });

  test("scheduler-recovery cancels observed drift follow-up only after operator confirmation", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_fnext_recovery_confirmed_cancel";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_beta_done",
        workerId: "worker-beta",
        instruction: "Patch beta.",
        contextSnapshot:
          "parentTurnId=turn-fnext-recovery-confirmed; isolatedContext=true; parallelGroup=implementation; writeSet=src/beta.ts",
      });
      await taskPlane.setDelegationStatus({
        id: "d_beta_done",
        status: "completed",
        resultSummary: "Patched beta and gamma.",
        observedWriteSet: ["src/beta.ts", "src/gamma.ts"],
        observedWriteSetSource: "patch",
      });
      await taskPlane.enqueueDelegation({
        id: "d_gamma_followup",
        workerId: "worker-gamma",
        instruction: "Patch gamma after beta evidence is reviewed.",
        contextSnapshot:
          "parentTurnId=turn-fnext-recovery-confirmed; isolatedContext=true; parallelGroup=implementation; writeSet=src/gamma.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "scheduler-recovery",
        "--session-id",
        sessionId,
        "--action-id",
        "recover_d_beta_done_observed_write_set_overlap",
        "--confirm-cancel-observed-drift",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      sessionId,
      workflowMode: "bounded-local-recovery",
      dryRun: false,
      cancelledDelegationIds: ["d_gamma_followup"],
      actionResults: [
        expect.objectContaining({
          actionId: "recover_d_beta_done_observed_write_set_overlap",
          actionType: "review-observed-write-set",
          result: "cancelled-queued-subagents",
          mutation: "cancelled-queued-subagents",
          queuedDelegationIds: ["d_gamma_followup"],
          cancelledDelegationIds: ["d_gamma_followup"],
        }),
      ],
      finalRecoveryPlan: expect.objectContaining({
        canRecover: false,
        recoveryActions: [],
      }),
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation.find((entry) => entry.id === "d_beta_done")?.status).toBe(
        "completed",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_gamma_followup")?.status).toBe(
        "cancelled",
      );
      expect(taskState.delegation.find((entry) => entry.id === "d_gamma_followup")).toMatchObject({
        resultSummary:
          "Scheduler recovery cancelled d_gamma_followup after confirmed observed write-set drift review.",
      });
    } finally {
      resultStore.close();
    }
  });

  test("run-delegation records observed write-set evidence for completed child output", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f10_observed_writes";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_patch",
        workerId: "worker-a",
        instruction: "Patch alpha and beta.",
        contextSnapshot:
          "parentTurnId=turn-f10-observed; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-delegation",
        "--session-id",
        sessionId,
        "--worker-id",
        "worker-a",
        "--observed-write-set",
        "src/alpha.ts, src/beta.ts,src/alpha.ts",
        "--observed-write-set-source",
        "patch",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_patch",
      subagentRun: {
        subagentId: "d_patch",
        status: "completed",
        observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
        observedWriteSetSource: "patch",
        parentVisibleResult: {
          observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
          observedWriteSetSource: "patch",
        },
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d_patch",
        status: "completed",
        observedWriteSet: ["src/alpha.ts", "src/beta.ts"],
        observedWriteSetSource: "patch",
      });
    } finally {
      resultStore.close();
    }
  });

  test("run-delegation extracts observed write-set evidence from patch artifact", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f11_observed_write_artifact";
    const patchPath = join(env.HOTFLOW_WORKSPACE_ROOT, "observed-write-set.patch");
    writeFileSync(
      patchPath,
      [
        "diff --git a/src/alpha.ts b/src/alpha.ts",
        "index 1111111..2222222 100644",
        "--- a/src/alpha.ts",
        "+++ b/src/alpha.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/docs/plan.md b/docs/plan.md",
        "new file mode 100644",
        "index 0000000..3333333",
        "--- /dev/null",
        "+++ b/docs/plan.md",
        "@@ -0,0 +1 @@",
        "+plan",
      ].join("\n"),
    );

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_artifact",
        workerId: "worker-a",
        instruction: "Patch alpha and planning docs.",
        contextSnapshot:
          "parentTurnId=turn-f11-observed; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-delegation",
        "--session-id",
        sessionId,
        "--worker-id",
        "worker-a",
        "--observed-write-set-artifact",
        patchPath,
        "--observed-write-set-source",
        "patch",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_artifact",
      subagentRun: {
        subagentId: "d_artifact",
        status: "completed",
        observedWriteSet: ["src/alpha.ts", "docs/plan.md"],
        observedWriteSetSource: "patch",
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d_artifact",
        status: "completed",
        observedWriteSet: ["src/alpha.ts", "docs/plan.md"],
        observedWriteSetSource: "patch",
      });
    } finally {
      resultStore.close();
    }
  });

  test("run-delegation rejects observed write-set artifacts outside worker roots", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_f11_observed_write_artifact_scope";
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "hotflow-f11-forbidden-"));
    cleanupPaths.push(forbiddenRoot);
    const patchPath = join(forbiddenRoot, "changes.patch");
    writeFileSync(
      patchPath,
      ["diff --git a/src/alpha.ts b/src/alpha.ts", "--- a/src/alpha.ts", "+++ b/src/alpha.ts"].join(
        "\n",
      ),
    );

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_forbidden_artifact",
        workerId: "worker-a",
        instruction: "Patch alpha.",
        contextSnapshot:
          "parentTurnId=turn-f11-forbidden; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-delegation",
        "--session-id",
        sessionId,
        "--worker-id",
        "worker-a",
        "--observed-write-set-artifact",
        patchPath,
      ],
      {
        env: {
          ...env,
          TMPDIR: join(env.HOTFLOW_WORKSPACE_ROOT, "allowed-tmp"),
          TMP: join(env.HOTFLOW_WORKSPACE_ROOT, "allowed-tmp"),
          TEMP: join(env.HOTFLOW_WORKSPACE_ROOT, "allowed-tmp"),
        },
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Observed write-set artifact must be inside an allowed worker artifact root",
    );
  });

  test("run-delegation collects observed write-set evidence from workspace git diff", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave_fnext_git_diff_observed";
    const workspaceRoot = env.HOTFLOW_WORKSPACE_ROOT;
    const alphaPath = join(workspaceRoot, "src", "alpha.ts");
    const betaPath = join(workspaceRoot, "src", "beta.ts");
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(alphaPath, "alpha baseline\n");
    writeFileSync(betaPath, "beta baseline\n");
    writeMinimalGitIndex(workspaceRoot, ["src/alpha.ts", "src/beta.ts"]);
    writeFileSync(alphaPath, "alpha changed\n");

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_git_diff",
        workerId: "worker-a",
        instruction: "Patch alpha and collect observed writes from git diff.",
        contextSnapshot:
          "parentTurnId=turn-fnext-git-diff; isolatedContext=true; parallelGroup=implementation; writeSet=src/alpha.ts",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-delegation",
        "--session-id",
        sessionId,
        "--worker-id",
        "worker-a",
        "--observed-write-set-from-git-diff",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_git_diff",
      subagentRun: {
        subagentId: "d_git_diff",
        status: "completed",
        observedWriteSet: ["src/alpha.ts"],
        observedWriteSetSource: "diff",
      },
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d_git_diff",
        status: "completed",
        observedWriteSet: ["src/alpha.ts"],
        observedWriteSetSource: "diff",
      });
    } finally {
      resultStore.close();
    }
  });

  test("lets explicit run-delegation verification input override delegation handoff contract", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave33_runtime_override";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d_override",
        taskId: "todo_override",
        workerId: "worker-a",
        instruction: "Implement runtime override contract.",
        verificationRequest: {
          verificationId: "v_contract",
          verifierId: "verifier-a",
          requirement: "contract requirement",
        },
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-delegation",
        "--session-id",
        sessionId,
        "--worker-id",
        "worker-a",
        "--verifier-id",
        "verifier-b",
        "--verification-id",
        "v_runtime",
        "--requirement",
        "runtime override requirement",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      delegationId: "d_override",
      verificationId: "v_runtime",
      verificationStatus: "pending",
      verificationSource: "mixed",
      pendingVerificationMailboxSize: 1,
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d_override",
        verificationRequest: {
          verificationId: "v_contract",
          verifierId: "verifier-a",
          requirement: "contract requirement",
        },
      });
      expect(taskState.verification[0]).toMatchObject({
        id: "v_runtime",
        taskId: "todo_override",
        verifierId: "verifier-b",
        requirement: "runtime override requirement",
        status: "pending",
      });
    } finally {
      resultStore.close();
    }
  });

  test("supports partial verification verdicts with structured checks", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave23_partial_verification";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.upsertVerification({
        id: "v_partial",
        taskId: "todo_partial",
        verifierId: "verifier-a",
        requirement: "replay still needs one manual pass",
        status: "pending",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "run-verification",
        "--session-id",
        sessionId,
        "--verifier-id",
        "verifier-a",
        "--verification-id",
        "v_partial",
        "--status",
        "partial",
        "--verdict",
        "Replay still needs one manual pass.",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "ok",
      verificationId: "v_partial",
      finalVerificationStatus: "partial",
      verdict: "partial",
      verifiedBy: "verifier-a",
      checks: [
        {
          id: "requirement",
          status: "partial",
          summary: "replay still needs one manual pass",
          detail: "Replay still needs one manual pass.",
        },
      ],
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.verification[0]).toMatchObject({
        id: "v_partial",
        status: "partial",
        verifierId: "verifier-a",
        verifiedBy: "verifier-a",
        verdict: "partial",
        verdictSummary: "Replay still needs one manual pass.",
        checks: [
          {
            id: "requirement",
            status: "partial",
            summary: "replay still needs one manual pass",
            detail: "Replay still needs one manual pass.",
          },
        ],
      });
      expect(taskState.notifications).toEqual([
        {
          id: "notification_verification_v_partial",
          kind: "verification_requested",
          recipientKind: "verifier",
          recipientId: "verifier-a",
          status: "acknowledged",
          summary: "Verification v_partial is pending for verifier verifier-a.",
          taskId: "todo_partial",
          verificationId: "v_partial",
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
          acknowledgedAtMs: expect.any(Number),
        },
      ]);
      expect(taskState.lifecycle).toEqual([
        {
          taskId: "todo_partial",
          title: "replay still needs one manual pass",
          status: "blocked",
          verificationVerdict: "partial",
          latestVerificationId: "v_partial",
        },
      ]);
    } finally {
      resultStore.close();
    }
  });

  test("refuses to consume delegation assigned to another worker", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave12_wrong_worker";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "d1",
        workerId: "worker-a",
        instruction: "Only worker-a may consume this.",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-delegation", "--session-id", sessionId, "--worker-id", "worker-b"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("No queued delegation found for worker: worker-b");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.delegation[0]).toMatchObject({
        id: "d1",
        status: "queued",
      });
      expect(taskState.verification).toHaveLength(0);
    } finally {
      resultStore.close();
    }
  });

  test("refuses to consume verification assigned to another verifier", async () => {
    const { dbPath, env } = createWorkerJobsEnv();
    const sessionId = "sess_wave12_wrong_verifier";

    const seedStore = new SessionStore({ dbPath });
    try {
      seedStore.createSession({ sessionId });
      const taskPlane = new SessionStoreTaskPlanePort(seedStore, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.upsertVerification({
        id: "v1",
        verifierId: "verifier-a",
        requirement: "worker output is acceptable",
        status: "pending",
      });
    } finally {
      seedStore.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-verification", "--session-id", sessionId, "--verifier-id", "verifier-b"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("No pending verification found for verifier: verifier-b");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.verification[0]).toMatchObject({
        id: "v1",
        status: "pending",
        verifierId: "verifier-a",
      });
    } finally {
      resultStore.close();
    }
  });
});
