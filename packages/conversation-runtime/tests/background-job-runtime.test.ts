import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ConversationRuntimeInput,
  createConversationRuntimeBackgroundJobStore,
  createConversationRuntimeBackgroundJobTask,
  createConversationRuntimeBackgroundJobTurnExecutor,
  createFileConversationRuntimeBackgroundJobStore,
  createMemoryEvidenceRecord,
  createSQLiteConversationRuntimeBackgroundJobStore,
  recoverConversationRuntimeBackgroundJobs,
  runConversationRuntimeBackgroundJobWorkerLoop,
  transitionConversationRuntimeBackgroundJob,
} from "../src/index.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("conversation runtime background job contract", () => {
  it("creates a resumable background job with budget, allowed tools, policy refs, and queue input", () => {
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-web-learn-1",
      sessionKey: "session-1",
      title: "持续阅读网页证据",
      objective: "读取 URL、二次提取正文、回填证据并入库",
      trigger: {
        kind: "manual",
        requestedBy: "user",
      },
      budget: {
        tokenLimit: 40_000,
        fileCountLimit: 12,
        videoMinuteLimit: 0,
        estimatedCostTier: "low",
      },
      allowedTools: ["web_extract", "web_extract_artifact_read"],
      policyEnvelopeRefs: ["policy:background:web-learn"],
      evidenceRefIds: ["evidence:url-request"],
      sourceRefs: ["https://example.test/post"],
      createdAtMs: 100,
      metadata: {
        workflow: "url-learning",
      },
    });

    expect(job.record).toMatchObject({
      schemaVersion: "conversation-runtime.background-job.v1",
      jobId: "job-web-learn-1",
      sessionKey: "session-1",
      status: "queued",
      title: "持续阅读网页证据",
      objective: "读取 URL、二次提取正文、回填证据并入库",
      budget: {
        tokenLimit: 40_000,
        fileCountLimit: 12,
        videoMinuteLimit: 0,
        estimatedCostTier: "low",
      },
      permissions: {
        allowedTools: ["web_extract", "web_extract_artifact_read"],
        requiresApproval: true,
      },
      policyEnvelopeRefs: ["policy:background:web-learn"],
      evidenceRefIds: ["evidence:url-request"],
      sourceRefs: ["https://example.test/post"],
      createdAtMs: 100,
      updatedAtMs: 100,
    });
    expect(job.queueInput).toMatchObject({
      id: "background-job:job-web-learn-1",
      sessionKey: "session-1",
      mode: "task-notification",
      priority: "later",
      origin: "task",
      workload: "background",
      isMeta: true,
      skipSlashCommands: true,
      metadata: {
        jobId: "job-web-learn-1",
        backgroundJob: true,
        allowedTools: ["web_extract", "web_extract_artifact_read"],
      },
    });
  });

  it("tracks pause, resume, retry, delegate, and completion without losing audit refs", () => {
    const created = createConversationRuntimeBackgroundJobTask({
      jobId: "job-media-backfill",
      sessionKey: "session-1",
      title: "媒体证据回填",
      objective: "按授权预算回填媒体清单证据",
      trigger: { kind: "manual", requestedBy: "user" },
      budget: { tokenLimit: 8_000, fileCountLimit: 4, videoMinuteLimit: 2 },
      allowedTools: ["media_understanding"],
      policyEnvelopeRefs: ["policy:media-backfill"],
      createdAtMs: 10,
    }).record;

    const running = transitionConversationRuntimeBackgroundJob(created, {
      type: "start",
      occurredAtMs: 20,
      workerId: "worker-1",
    });
    const paused = transitionConversationRuntimeBackgroundJob(running, {
      type: "pause",
      occurredAtMs: 30,
      requestedBy: "user",
      reason: "等用户确认预算",
    });
    const resumed = transitionConversationRuntimeBackgroundJob(paused, {
      type: "resume",
      occurredAtMs: 40,
      policyEnvelopeRefs: ["policy:resume-media-backfill"],
    });
    const delegated = transitionConversationRuntimeBackgroundJob(resumed, {
      type: "delegate",
      occurredAtMs: 50,
      subagentRunId: "delegate-media-1",
      summary: "让 verifier 检查媒体证据准入",
    });
    const retrying = transitionConversationRuntimeBackgroundJob(delegated, {
      type: "retry",
      occurredAtMs: 60,
      reason: "provider timeout",
      nextAttemptAtMs: 120,
    });
    const completed = transitionConversationRuntimeBackgroundJob(retrying, {
      type: "complete",
      occurredAtMs: 130,
      summary: "媒体清单证据已回填，未做语义理解",
      evidenceRefIds: ["evidence:media-inventory-1"],
    });

    expect(completed).toMatchObject({
      status: "completed",
      attempt: 2,
      workerId: "worker-1",
      activeSubagentRunIds: ["delegate-media-1"],
      policyEnvelopeRefs: ["policy:media-backfill", "policy:resume-media-backfill"],
      evidenceRefIds: ["evidence:media-inventory-1"],
      completedAtMs: 130,
      summary: "媒体清单证据已回填，未做语义理解",
    });
    expect(completed.events.map((event) => event.type)).toEqual([
      "created",
      "started",
      "paused",
      "resumed",
      "delegated",
      "retry_scheduled",
      "completed",
    ]);
  });

  it("recovers active background jobs as paused after restart", () => {
    const store = createConversationRuntimeBackgroundJobStore();
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-stale",
      sessionKey: "session-1",
      title: "重启恢复测试",
      objective: "模拟后台任务正在执行时应用重启",
      trigger: { kind: "schedule", scheduleRef: "cron:daily-learning" },
      budget: { tokenLimit: 2_000 },
      allowedTools: ["web_extract"],
      createdAtMs: 1,
    }).record;
    const running = transitionConversationRuntimeBackgroundJob(job, {
      type: "start",
      occurredAtMs: 2,
      workerId: "worker-1",
    });

    store.upsert(running);
    const recovered = recoverConversationRuntimeBackgroundJobs(store.load(), {
      nowMs: () => 99,
      reason: "runtime restart",
    });

    expect(recovered).toEqual([
      expect.objectContaining({
        jobId: "job-stale",
        status: "paused",
        pausedAtMs: 99,
        updatedAtMs: 99,
        workerId: "worker-1",
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "recovered",
            summary: "Active background job was paused for safe recovery after runtime restart.",
          }),
        ]),
      }),
    ]);
  });

  it("persists background jobs to a file store and reloads them for recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-background-jobs-"));
    tempRoots.push(root);
    const storePath = join(root, "background-jobs.json");
    const firstStore = createFileConversationRuntimeBackgroundJobStore({ path: storePath });
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-persisted",
      sessionKey: "session-1",
      title: "持久化后台任务",
      objective: "验证后台任务重启恢复",
      trigger: { kind: "schedule", scheduleRef: "cron:nightly" },
      budget: { tokenLimit: 10_000 },
      allowedTools: ["web_extract"],
      policyEnvelopeRefs: ["policy:persisted"],
      createdAtMs: 10,
    }).record;
    const running = transitionConversationRuntimeBackgroundJob(job, {
      type: "start",
      workerId: "worker-persisted",
      occurredAtMs: 20,
    });

    firstStore.upsert(running);

    const secondStore = createFileConversationRuntimeBackgroundJobStore({ path: storePath });
    const reloaded = secondStore.read("job-persisted");
    const recovered = recoverConversationRuntimeBackgroundJobs(secondStore.load(), {
      nowMs: () => 50,
      reason: "desktop restart",
    });
    for (const record of recovered) {
      secondStore.upsert(record);
    }

    const finalStore = createFileConversationRuntimeBackgroundJobStore({ path: storePath });

    expect(reloaded).toMatchObject({
      jobId: "job-persisted",
      status: "running",
      workerId: "worker-persisted",
      policyEnvelopeRefs: ["policy:persisted"],
    });
    expect(finalStore.read("job-persisted")).toMatchObject({
      status: "paused",
      pausedAtMs: 50,
      events: expect.arrayContaining([expect.objectContaining({ type: "recovered" })]),
    });
  });

  it("runs queued persisted background jobs through an injected worker executor", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-background-worker-"));
    tempRoots.push(root);
    const dbPath = join(root, "background-runtime.sqlite");
    const store = createSQLiteConversationRuntimeBackgroundJobStore({ dbPath });
    store.upsert(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-worker-queued",
        sessionKey: "session-1",
        title: "后台 worker 执行",
        objective: "执行后台队列任务",
        trigger: { kind: "schedule", scheduleRef: "hourly-learning" },
        allowedTools: ["web_extract"],
        policyEnvelopeRefs: ["policy:worker"],
        createdAtMs: 100,
      }).record,
    );

    const report = await runConversationRuntimeBackgroundJobWorkerLoop({
      store,
      workerId: "background-worker-1",
      maxClaims: 1,
      nowMs: () => 200,
      executor: async (job, context) => {
        expect(context.workerId).toBe("background-worker-1");
        expect(job).toMatchObject({
          jobId: "job-worker-queued",
          status: "running",
          permissions: { allowedTools: ["web_extract"] },
        });
        return {
          status: "completed",
          summary: "后台任务已完成",
          evidenceRefIds: ["evidence:worker-result"],
          sourceRefs: ["https://example.test/source"],
        };
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "conversation-runtime.background-job-worker-loop.v1",
      workerId: "background-worker-1",
      status: "stopped",
      stoppedReason: "max-claims",
      claimedCount: 1,
      completedCount: 1,
      failedCount: 0,
      retryScheduledCount: 0,
      jobIds: ["job-worker-queued"],
    });
    expect(store.read("job-worker-queued")).toMatchObject({
      status: "completed",
      workerId: "background-worker-1",
      completedAtMs: 200,
      summary: "后台任务已完成",
      evidenceRefIds: ["evidence:worker-result"],
      sourceRefs: ["https://example.test/source"],
      events: expect.arrayContaining([
        expect.objectContaining({ type: "started", occurredAtMs: 200 }),
        expect.objectContaining({ type: "completed", occurredAtMs: 200 }),
      ]),
    });
  });

  it("adapts a background job into a generic background conversation runtime turn", async () => {
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-runtime-turn",
      sessionKey: "session-runtime",
      title: "通用后台运行时任务",
      objective: "读取证据、执行允许工具、回填结论",
      trigger: { kind: "manual", requestedBy: "user" },
      budget: {
        tokenLimit: 12_000,
        fileCountLimit: 3,
        videoMinuteLimit: 0,
        estimatedCostTier: "low",
      },
      allowedTools: ["custom.extract", "custom.persist"],
      allowedCapabilities: ["web-browse"],
      policyEnvelopeRefs: ["policy:runtime-turn"],
      evidenceRefIds: ["evidence:seed"],
      sourceRefs: ["https://example.test/runtime-turn"],
      metadata: {
        workflow: "generic-background",
      },
      createdAtMs: 100,
    }).record;
    const capturedInputs: ConversationRuntimeInput[] = [];

    const executor = createConversationRuntimeBackgroundJobTurnExecutor({
      runTurn: async (input, context) => {
        capturedInputs.push(input);
        expect(context.job.jobId).toBe("job-runtime-turn");
        expect(context.workerId).toBe("worker-runtime");
        return {
          turnId: "turn-runtime-background",
          sessionKey: input.sessionKey,
          replySource: "model",
          finalText: "后台 runtime turn 已完成。",
          responsePolicy: "result-first",
          memoryEvidenceRecords: [
            createMemoryEvidenceRecord({
              id: "evidence:runtime-memory",
              sourceKind: "url",
              sourceRef: "https://example.test/runtime-turn",
              evidenceRefs: ["evidence:tool-output"],
              policyEnvelopeRefs: ["policy:runtime-result"],
              observedAtMs: 220,
            }),
          ],
          events: [],
          operatorTrace: { items: [] },
        };
      },
    });

    const result = await executor(
      { ...job, status: "running", workerId: "worker-runtime" },
      { workerId: "worker-runtime", nowMs: 200 },
    );

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]).toMatchObject({
      surface: "background",
      channel: "background",
      messageId: "background-job:job-runtime-turn",
      sessionKey: "session-runtime",
      text: "读取证据、执行允许工具、回填结论",
      receivedAtMs: 200,
      queuePriority: "later",
      sender: {
        id: "background-worker:worker-runtime",
        role: "system",
      },
      trustedContext: {
        activeSessionKey: "session-runtime",
        metadata: {
          backgroundJob: true,
          jobId: "job-runtime-turn",
          workerId: "worker-runtime",
          title: "通用后台运行时任务",
          allowedTools: ["custom.extract", "custom.persist"],
          allowedCapabilities: ["web-browse"],
          budget: {
            tokenLimit: 12_000,
            fileCountLimit: 3,
            videoMinuteLimit: 0,
            estimatedCostTier: "low",
          },
          policyEnvelopeRefs: ["policy:runtime-turn"],
          evidenceRefIds: ["evidence:seed"],
          sourceRefs: ["https://example.test/runtime-turn"],
        },
      },
      metadata: {
        backgroundJob: true,
        jobId: "job-runtime-turn",
        workerId: "worker-runtime",
        allowedTools: ["custom.extract", "custom.persist"],
        allowedCapabilities: ["web-browse"],
        budget: {
          tokenLimit: 12_000,
          fileCountLimit: 3,
          videoMinuteLimit: 0,
          estimatedCostTier: "low",
        },
        workflow: "generic-background",
      },
    });
    expect(capturedInputs[0]?.metadata?.allowedTools).toEqual(["custom.extract", "custom.persist"]);
    expect(result).toEqual({
      status: "completed",
      summary: "后台 runtime turn 已完成。",
      evidenceRefIds: ["evidence:runtime-memory"],
      sourceRefs: ["https://example.test/runtime-turn"],
      policyEnvelopeRefs: ["policy:runtime-result"],
    });
  });

  it("adapts role-scoped scheduled learning metadata into a trusted Angel role profile", async () => {
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-role-scoped-learning",
      sessionKey: "role:director:learning",
      title: "导演每日学习",
      objective: "围绕导演岗位学习高质量 AI 制作资料，只生成待审经验候选。",
      trigger: { kind: "schedule", scheduleRef: "role-learning:director:daily" },
      allowedTools: ["web_extract", "director.learning.url", "director.learning.admit"],
      allowedCapabilities: ["learning"],
      metadata: {
        scheduledLearning: true,
        roleId: "director",
        roleTitle: "导演 Angel",
        roleDomain: "影视制作与 AI 工作流",
        learningScope: ["短剧制作", "AI 分镜"],
        admissionMode: "confirm_before_publish",
        candidateOnly: true,
        autoPublish: false,
        memorySync: "skip-auto-write",
      },
      createdAtMs: 100,
    }).record;
    const capturedInputs: ConversationRuntimeInput[] = [];

    const executor = createConversationRuntimeBackgroundJobTurnExecutor({
      runTurn: async (input) => {
        capturedInputs.push(input);
        return {
          turnId: "turn-role-learning",
          sessionKey: input.sessionKey,
          replySource: "model",
          finalText: "角色定时学习已生成待审候选。",
          responsePolicy: "review-gated",
          memoryEvidenceRecords: [],
          events: [],
          operatorTrace: { items: [] },
        };
      },
    });

    await executor(
      { ...job, status: "running", workerId: "worker-role-learning" },
      { workerId: "worker-role-learning", nowMs: 200 },
    );

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.trustedContext?.angelRoleProfile).toMatchObject({
      roleId: "director",
      title: "导演 Angel",
      domain: "影视制作与 AI 工作流",
      learningScope: ["短剧制作", "AI 分镜"],
    });
    expect(capturedInputs[0]?.trustedContext?.metadata).toMatchObject({
      scheduledLearning: true,
      candidateOnly: true,
      autoPublish: false,
      memorySync: "skip-auto-write",
      admissionMode: "confirm_before_publish",
    });
  });

  it("lets the background runtime turn adapter map runtime errors into retry decisions", async () => {
    const job = createConversationRuntimeBackgroundJobTask({
      jobId: "job-runtime-retry",
      sessionKey: "session-runtime",
      title: "后台 runtime 重试",
      objective: "调用可重试的后台能力",
      trigger: { kind: "runtime", reason: "retry-test" },
      allowedTools: ["custom.retryable"],
      createdAtMs: 100,
    }).record;

    const executor = createConversationRuntimeBackgroundJobTurnExecutor({
      runTurn: async () => {
        throw new Error("provider timeout");
      },
      classifyError: ({ error, context }) => ({
        status: "retry",
        reason: error instanceof Error ? error.message : String(error),
        nextAttemptAtMs: context.nowMs + 1_000,
        failureTaxonomy: ["provider_timeout"],
      }),
    });

    await expect(executor(job, { workerId: "worker-runtime", nowMs: 300 })).resolves.toEqual({
      status: "retry",
      reason: "provider timeout",
      nextAttemptAtMs: 1_300,
      failureTaxonomy: ["provider_timeout"],
    });
  });

  it("keeps paused jobs operator-gated and only claims retry jobs after their due time", async () => {
    const store = createConversationRuntimeBackgroundJobStore();
    const paused = transitionConversationRuntimeBackgroundJob(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-paused",
        sessionKey: "session-1",
        title: "暂停任务",
        objective: "等待人工恢复",
        trigger: { kind: "manual", requestedBy: "user" },
        allowedTools: ["web_extract"],
        createdAtMs: 100,
      }).record,
      {
        type: "pause",
        occurredAtMs: 110,
        requestedBy: "user",
        reason: "等待授权",
      },
    );
    const retryFuture = transitionConversationRuntimeBackgroundJob(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-retry-future",
        sessionKey: "session-1",
        title: "未来重试",
        objective: "未来再执行",
        trigger: { kind: "manual", requestedBy: "system" },
        allowedTools: ["web_extract"],
        createdAtMs: 100,
      }).record,
      {
        type: "retry",
        occurredAtMs: 120,
        reason: "provider timeout",
        nextAttemptAtMs: 500,
      },
    );
    store.upsert(paused);
    store.upsert(retryFuture);

    const idleReport = await runConversationRuntimeBackgroundJobWorkerLoop({
      store,
      workerId: "background-worker-1",
      nowMs: () => 400,
      executor: async () => ({ status: "completed" }),
    });

    expect(idleReport).toMatchObject({
      status: "stopped",
      stoppedReason: "no-ready-job",
      claimedCount: 0,
    });
    expect(store.read("job-paused")).toMatchObject({ status: "paused" });
    expect(store.read("job-retry-future")).toMatchObject({ status: "retry_scheduled" });

    const dueReport = await runConversationRuntimeBackgroundJobWorkerLoop({
      store,
      workerId: "background-worker-1",
      nowMs: () => 500,
      executor: async () => ({ status: "completed", summary: "重试完成" }),
    });

    expect(dueReport).toMatchObject({
      stoppedReason: "max-claims",
      claimedCount: 1,
      completedCount: 1,
      jobIds: ["job-retry-future"],
    });
    expect(store.read("job-paused")).toMatchObject({ status: "paused" });
    expect(store.read("job-retry-future")).toMatchObject({
      status: "completed",
      summary: "重试完成",
    });
  });
});
