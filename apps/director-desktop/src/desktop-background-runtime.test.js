import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createConversationRuntimeBackgroundJobTask,
  createMemoryEvidenceRecord,
} from "@hotflow/conversation-runtime";

import { createDesktopBackgroundRuntime } from "./desktop-background-runtime.cjs";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop background runtime", () => {
  it("runs queued persisted background jobs through an injected desktop conversation turn runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-desktop-background-runtime-"));
    tempRoots.push(root);
    const dbPath = join(root, "background-runtime.sqlite");
    const events = [];
    const capturedInputs = [];
    const runtime = createDesktopBackgroundRuntime({
      dataDir: root,
      env: {
        DIRECTOR_DESKTOP_BACKGROUND_RUNTIME_DB_PATH: dbPath,
        DIRECTOR_DESKTOP_BACKGROUND_WORKER_MAX_CLAIMS: "1",
      },
      emitDesktopEvent: (event) => events.push(event),
      nowMs: () => 200,
      runTurn: async (input) => {
        capturedInputs.push(input);
        return {
          turnId: "desktop-background-turn",
          sessionKey: input.sessionKey,
          replySource: "model",
          finalText: "桌面后台任务完成。",
          responsePolicy: "result-first",
          memoryEvidenceRecords: [
            createMemoryEvidenceRecord({
              id: "evidence:desktop-background",
              sourceKind: "url",
              sourceRef: "https://example.test/background",
              policyEnvelopeRefs: ["policy:desktop-background-result"],
              observedAtMs: 220,
            }),
          ],
          events: [],
          operatorTrace: { items: [] },
        };
      },
    });
    runtime.backgroundJobStore.upsert(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-desktop-background",
        sessionKey: "desktop:background",
        title: "桌面后台任务",
        objective: "后台读取并整理证据",
        trigger: { kind: "manual", requestedBy: "user" },
        allowedTools: ["web_extract", "web_extract_artifact_read"],
        policyEnvelopeRefs: ["policy:desktop-background"],
        sourceRefs: ["https://example.test/background"],
        createdAtMs: 100,
      }).record,
    );

    const report = await runtime.runWorkerOnce();

    expect(report).toMatchObject({
      schemaVersion: "conversation-runtime.background-job-worker-loop.v1",
      workerId: "director-desktop-background-worker",
      claimedCount: 1,
      completedCount: 1,
      jobIds: ["job-desktop-background"],
    });
    expect(capturedInputs).toEqual([
      expect.objectContaining({
        surface: "desktop",
        channel: "desktop-background",
        messageId: "background-job:job-desktop-background",
        sessionKey: "desktop:background",
        text: "后台读取并整理证据",
        metadata: expect.objectContaining({
          backgroundJob: true,
          jobId: "job-desktop-background",
          allowedTools: ["web_extract", "web_extract_artifact_read"],
          sourceRefs: ["https://example.test/background"],
        }),
      }),
    ]);
    expect(runtime.backgroundJobStore.read("job-desktop-background")).toMatchObject({
      status: "completed",
      summary: "桌面后台任务完成。",
      evidenceRefIds: ["evidence:desktop-background"],
      sourceRefs: ["https://example.test/background"],
      policyEnvelopeRefs: ["policy:desktop-background", "policy:desktop-background-result"],
    });
    expect(events).toEqual([
      expect.objectContaining({
        actionType: "background.worker",
        backgroundWorker: expect.objectContaining({ claimedCount: 1 }),
      }),
    ]);
  });

  it("runs role-scoped scheduled learning jobs through an injected learning runner before generic model turns", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-desktop-background-learning-"));
    tempRoots.push(root);
    const dbPath = join(root, "background-runtime.sqlite");
    const capturedLearningJobs = [];
    let genericRunTurnCalled = false;
    const runtime = createDesktopBackgroundRuntime({
      dataDir: root,
      env: {
        DIRECTOR_DESKTOP_BACKGROUND_RUNTIME_DB_PATH: dbPath,
        DIRECTOR_DESKTOP_BACKGROUND_WORKER_MAX_CLAIMS: "1",
      },
      nowMs: () => 500,
      runTurn: async () => {
        genericRunTurnCalled = true;
        throw new Error("scheduled learning should not use the generic model turn");
      },
      scheduledLearningRunner: async ({ job, context }) => {
        capturedLearningJobs.push({ job, context });
        return {
          status: "completed",
          summary: "角色定时学习已生成 1 条待审候选。",
          evidenceRefIds: ["learning-artifact:director-daily"],
          sourceRefs: ["https://example.test/director-ai-workflow"],
          policyEnvelopeRefs: ["policy:role-learning"],
        };
      },
    });
    runtime.backgroundJobStore.upsert(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-role-learning",
        sessionKey: "role:director:learning",
        title: "导演每日学习",
        objective: "围绕导演岗位学习高质量 AI 制作资料，只生成待审经验候选。",
        trigger: { kind: "schedule", scheduleRef: "role-learning:director:daily" },
        allowedTools: ["web_extract", "director.learning.url", "director.learning.admit"],
        allowedCapabilities: ["learning"],
        sourceRefs: ["https://example.test/director-ai-workflow"],
        policyEnvelopeRefs: ["policy:role-learning"],
        metadata: {
          scheduledLearning: true,
          roleId: "director",
          roleTitle: "导演 Angel",
          learningScope: ["短剧制作", "AI 分镜"],
          candidateOnly: true,
          autoPublish: false,
          memorySync: "skip-auto-write",
        },
        createdAtMs: 100,
      }).record,
    );

    const report = await runtime.runWorkerOnce();

    expect(genericRunTurnCalled).toBe(false);
    expect(capturedLearningJobs).toHaveLength(1);
    expect(capturedLearningJobs[0]).toMatchObject({
      job: {
        jobId: "job-role-learning",
        metadata: {
          scheduledLearning: true,
          candidateOnly: true,
          autoPublish: false,
          memorySync: "skip-auto-write",
        },
      },
      context: { workerId: "director-desktop-background-worker", nowMs: 500 },
    });
    expect(report).toMatchObject({
      completedCount: 1,
      failedCount: 0,
      retryScheduledCount: 0,
    });
    expect(runtime.backgroundJobStore.read("job-role-learning")).toMatchObject({
      status: "completed",
      summary: "角色定时学习已生成 1 条待审候选。",
      evidenceRefIds: ["learning-artifact:director-daily"],
      sourceRefs: ["https://example.test/director-ai-workflow"],
      policyEnvelopeRefs: ["policy:role-learning"],
    });
  });
});
