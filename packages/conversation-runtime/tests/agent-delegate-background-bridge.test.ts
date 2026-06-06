import { describe, expect, it } from "vitest";

import {
  createAgentDelegateBackgroundJobProjection,
  createConversationRuntimeBackgroundJobStore,
} from "../src/index.js";

describe("agent delegate background bridge", () => {
  it("projects queued task-plane subagent runs into background job records", () => {
    const projection = createAgentDelegateBackgroundJobProjection({
      run: {
        subagentId: "subagent-research-1",
        parentTurnId: "turn-1",
        profileId: "researcher",
        workerId: "researcher",
        status: "queued",
        role: "explore",
        isolatedContext: true,
        instruction: "读取网页证据并生成摘要",
        contextSnapshot:
          "parentTurnId=turn-1;sessionKey=desktop:main;tools=web_extract,director.knowledge.recall;permissions=read;memoryLayers=L0,L1;maxTurns=4;requesterSessionKey=desktop:main",
        createdAtMs: 10,
        updatedAtMs: 10,
        parentVisibleResult: {
          status: "queued",
          summary: "Queued Agent OS subagent subagent-research-1.",
        },
      },
      nowMs: () => 20,
    });

    expect(projection).toMatchObject({
      schemaVersion: "conversation-runtime.agent-delegate-background-job-projection.v1",
      action: "create",
      backgroundJob: {
        schemaVersion: "conversation-runtime.background-job.v1",
        jobId: "agent-delegate:subagent-research-1",
        sessionKey: "desktop:main",
        title: "Agent subagent-research-1",
        objective: "读取网页证据并生成摘要",
        status: "queued",
        trigger: {
          kind: "subagent",
          parentTurnRunId: "turn-1",
        },
        permissions: {
          allowedTools: ["web_extract", "director.knowledge.recall"],
        },
        metadata: expect.objectContaining({
          source: "agent.delegate",
          subagentId: "subagent-research-1",
          profileId: "researcher",
          workerId: "researcher",
          requesterSessionKey: "desktop:main",
        }),
      },
    });
  });

  it("updates existing background jobs from subagent lifecycle transitions", () => {
    const store = createConversationRuntimeBackgroundJobStore();
    const queued = createAgentDelegateBackgroundJobProjection({
      run: {
        subagentId: "subagent-video-1",
        parentTurnId: "turn-2",
        profileId: "researcher",
        workerId: "researcher",
        status: "queued",
        role: "explore",
        isolatedContext: true,
        instruction: "回填媒体清单证据",
        contextSnapshot:
          "parentTurnId=turn-2;sessionKey=desktop:main;tools=media_understanding;permissions=read;memoryLayers=L0;maxTurns=4",
        createdAtMs: 10,
        updatedAtMs: 10,
        parentVisibleResult: { status: "queued" },
      },
      nowMs: () => 10,
    });
    store.upsert(queued.backgroundJob);

    const running = createAgentDelegateBackgroundJobProjection({
      previous: store.read("agent-delegate:subagent-video-1"),
      run: {
        subagentId: "subagent-video-1",
        parentTurnId: "turn-2",
        profileId: "researcher",
        workerId: "researcher",
        status: "running",
        role: "explore",
        isolatedContext: true,
        instruction: "回填媒体清单证据",
        contextSnapshot:
          "parentTurnId=turn-2;sessionKey=desktop:main;tools=media_understanding;permissions=read;memoryLayers=L0;maxTurns=4",
        createdAtMs: 10,
        updatedAtMs: 30,
        parentVisibleResult: { status: "running" },
      },
      nowMs: () => 30,
    });

    const completed = createAgentDelegateBackgroundJobProjection({
      previous: running.backgroundJob,
      run: {
        subagentId: "subagent-video-1",
        parentTurnId: "turn-2",
        profileId: "researcher",
        workerId: "researcher",
        status: "completed",
        role: "explore",
        isolatedContext: true,
        instruction: "回填媒体清单证据",
        contextSnapshot:
          "parentTurnId=turn-2;sessionKey=desktop:main;tools=media_understanding;permissions=read;memoryLayers=L0;maxTurns=4",
        resultSummary: "媒体清单已回填，媒体内容未理解。",
        createdAtMs: 10,
        updatedAtMs: 50,
        completedAtMs: 50,
        parentVisibleResult: {
          status: "completed",
          summary: "媒体清单已回填，媒体内容未理解。",
        },
      },
      nowMs: () => 50,
    });

    expect(running).toMatchObject({
      action: "transition",
      backgroundJob: {
        status: "running",
        workerId: "researcher",
        events: expect.arrayContaining([expect.objectContaining({ type: "started" })]),
      },
    });
    expect(completed).toMatchObject({
      action: "transition",
      backgroundJob: {
        status: "completed",
        completedAtMs: 50,
        summary: "媒体清单已回填，媒体内容未理解。",
        events: expect.arrayContaining([expect.objectContaining({ type: "completed" })]),
      },
    });
  });

  it("records a subagent.failed lifecycle event when delegated work fails", () => {
    const queued = createAgentDelegateBackgroundJobProjection({
      run: {
        subagentId: "subagent-failure-1",
        parentTurnId: "turn-failure",
        profileId: "verifier",
        workerId: "verifier",
        status: "queued",
        role: "verify",
        isolatedContext: true,
        instruction: "验证生成结果是否符合证据",
        contextSnapshot: "parentTurnId=turn-failure;sessionKey=desktop:main;tools=web_extract",
        createdAtMs: 10,
        updatedAtMs: 10,
        parentVisibleResult: { status: "queued" },
      },
      nowMs: () => 10,
    });

    const failed = createAgentDelegateBackgroundJobProjection({
      previous: queued.backgroundJob,
      run: {
        subagentId: "subagent-failure-1",
        parentTurnId: "turn-failure",
        profileId: "verifier",
        workerId: "verifier",
        status: "failed",
        role: "verify",
        isolatedContext: true,
        instruction: "验证生成结果是否符合证据",
        contextSnapshot: "parentTurnId=turn-failure;sessionKey=desktop:main;tools=web_extract",
        error: "verifier model timed out",
        createdAtMs: 10,
        updatedAtMs: 40,
        completedAtMs: 40,
        parentVisibleResult: {
          status: "failed",
          summary: "验证子代理超时。",
        },
      },
      nowMs: () => 40,
    });

    expect(failed.backgroundJob).toMatchObject({
      status: "failed",
      failureTaxonomy: expect.arrayContaining(["agent_delegate_failed"]),
      events: expect.arrayContaining([
        expect.objectContaining({ type: "failed", summary: "verifier model timed out" }),
        expect.objectContaining({
          type: "subagent.failed",
          summary: "verifier model timed out",
          metadata: expect.objectContaining({
            subagentId: "subagent-failure-1",
            parentTurnId: "turn-failure",
            profileId: "verifier",
            workerId: "verifier",
            role: "verify",
          }),
        }),
      ]),
    });
  });
});
