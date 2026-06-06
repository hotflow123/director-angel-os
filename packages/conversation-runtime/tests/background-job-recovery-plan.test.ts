import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeBackgroundJobRecoveryPlan,
  createConversationRuntimeBackgroundJobTask,
  transitionConversationRuntimeBackgroundJob,
} from "../src/index.js";

describe("conversation runtime background job recovery plan", () => {
  it("creates an operator-visible recovery plan for paused recovered jobs", () => {
    const recovered = transitionConversationRuntimeBackgroundJob(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-recovered",
        sessionKey: "session-1",
        title: "重启后恢复",
        objective: "继续读取证据并回填知识",
        trigger: { kind: "schedule", scheduleRef: "cron:nightly-learning" },
        budget: { tokenLimit: 12_000, fileCountLimit: 3 },
        allowedTools: ["web_extract", "web_extract_artifact_read"],
        policyEnvelopeRefs: ["policy:background-learning"],
        createdAtMs: 10,
      }).record,
      {
        type: "pause",
        occurredAtMs: 20,
        requestedBy: "system",
        reason: "runtime restart",
      },
    );

    const plan = createConversationRuntimeBackgroundJobRecoveryPlan([recovered], {
      nowMs: () => 100,
    });

    expect(plan).toMatchObject({
      schemaVersion: "conversation-runtime.background-job-recovery-plan.v1",
      createdAtMs: 100,
      recoverableCount: 1,
      blockedCount: 0,
      actions: [
        expect.objectContaining({
          jobId: "job-recovered",
          action: "resume",
          requiresOperatorApproval: true,
          reason: "paused_job_can_resume_after_operator_review",
          budget: { tokenLimit: 12_000, fileCountLimit: 3 },
          allowedTools: ["web_extract", "web_extract_artifact_read"],
          policyEnvelopeRefs: ["policy:background-learning"],
        }),
      ],
    });
  });

  it("blocks recovery when a job has no allowed tools or exhausted attempts", () => {
    const noTools = createConversationRuntimeBackgroundJobTask({
      jobId: "job-no-tools",
      sessionKey: "session-1",
      title: "缺工具",
      objective: "无法恢复",
      trigger: { kind: "manual", requestedBy: "user" },
      createdAtMs: 1,
    }).record;
    const exhausted = transitionConversationRuntimeBackgroundJob(
      createConversationRuntimeBackgroundJobTask({
        jobId: "job-exhausted",
        sessionKey: "session-1",
        title: "重试耗尽",
        objective: "无法继续自动恢复",
        trigger: { kind: "manual", requestedBy: "user" },
        allowedTools: ["web_extract"],
        maxAttempts: 1,
        createdAtMs: 1,
      }).record,
      {
        type: "retry",
        occurredAtMs: 2,
        reason: "timeout",
      },
    );

    const plan = createConversationRuntimeBackgroundJobRecoveryPlan([noTools, exhausted], {
      nowMs: () => 200,
    });

    expect(plan).toMatchObject({
      recoverableCount: 0,
      blockedCount: 2,
      actions: [
        expect.objectContaining({
          jobId: "job-no-tools",
          action: "manual_review",
          reason: "allowed_tools_missing",
          requiresOperatorApproval: true,
        }),
        expect.objectContaining({
          jobId: "job-exhausted",
          action: "manual_review",
          reason: "retry_budget_exhausted",
          requiresOperatorApproval: true,
        }),
      ],
    });
  });
});
