import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ConversationRuntimeInput,
  type ConversationRuntimeTurnDecision,
  createConversationRunRegistry,
  createFileConversationRunRegistryStore,
  runConversationRuntimeTurn,
} from "../src/index.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createInput(overrides: Partial<ConversationRuntimeInput> = {}): ConversationRuntimeInput {
  return {
    surface: "desktop",
    channel: "director-desktop",
    messageId: "message-1",
    sessionKey: "session-1",
    text: "说一句中文",
    sender: { id: "user-1" },
    ...overrides,
  };
}

function createTurnDecision(overrides: Partial<ConversationRuntimeTurnDecision> = {}) {
  return {
    intent: { kind: "chat" },
    responsePolicy: "result-first",
    audience: "user",
    userText: "说一句中文",
    memoryDecision: { action: "transient", reason: "unit test" },
    shouldInvokeRecall: true,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
    ...overrides,
  } satisfies ConversationRuntimeTurnDecision;
}

describe("conversation run registry", () => {
  it("tracks start, events, finalize, and list by session", () => {
    const registry = createConversationRunRegistry({
      nowMs: (() => {
        let next = 100;
        return () => next++;
      })(),
      turnRunIdFactory: () => "turn-run-1",
    });

    const started = registry.start({
      turnId: "turn-1",
      input: createInput(),
      status: "queued",
      memoryEvidenceRefs: ["memory-evidence-1"],
      sourceRefs: ["source-evidence-1"],
      failureTaxonomy: ["url_access_limited"],
    });

    registry.appendEvent(started.turnRunId, {
      kind: "runtime.trace",
      summary: "preflight finished",
      metadata: { stage: "preflight" },
    });

    const completed = registry.finalize(started.turnRunId, {
      status: "completed",
      userVisibleSummary: "完成",
    });

    expect(completed.status).toBe("completed");
    expect(completed.memoryEvidenceRefs).toEqual(["memory-evidence-1"]);
    expect(completed.sourceRefs).toEqual(["source-evidence-1"]);
    expect(completed.failureTaxonomy).toEqual(["url_access_limited"]);
    expect(completed.events).toHaveLength(1);
    expect(registry.read(started.turnRunId)?.userVisibleSummary).toBe("完成");
    expect(registry.list({ sessionKey: "session-1" }).map((run) => run.turnRunId)).toEqual([
      "turn-run-1",
    ]);
  });

  it("persists run records so a later registry can list and read them", () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-run-registry-"));
    tempRoots.push(root);
    const storePath = join(root, "runs.json");
    const firstRegistry = createConversationRunRegistry({
      nowMs: (() => {
        let next = 1000;
        return () => next++;
      })(),
      turnRunIdFactory: () => "turn-run-persisted",
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });

    const started = firstRegistry.start({
      turnId: "turn-persisted",
      input: createInput({ sessionKey: "session-persisted", messageId: "message-persisted" }),
      status: "running",
      sourceRefs: ["source-ref-1"],
    });
    firstRegistry.appendEvent(started.turnRunId, {
      kind: "runtime.trace",
      summary: "persisted trace",
    });
    firstRegistry.finalize(started.turnRunId, {
      status: "completed",
      userVisibleSummary: "持久化完成",
      sourceRefs: ["source-ref-2"],
    });

    const secondRegistry = createConversationRunRegistry({
      nowMs: () => 2000,
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });
    const reloaded = secondRegistry.read("turn-run-persisted");

    expect(reloaded).toMatchObject({
      turnRunId: "turn-run-persisted",
      turnId: "turn-persisted",
      sessionKey: "session-persisted",
      messageId: "message-persisted",
      status: "completed",
      userVisibleSummary: "持久化完成",
      sourceRefs: ["source-ref-1", "source-ref-2"],
    });
    expect(reloaded?.events).toMatchObject([{ summary: "persisted trace" }]);
    expect(secondRegistry.list({ sessionKey: "session-persisted" })).toHaveLength(1);
  });

  it("persists policy envelope refs beside run and timeline records", () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-run-registry-policy-"));
    tempRoots.push(root);
    const storePath = join(root, "runs.json");
    const firstRegistry = createConversationRunRegistry({
      nowMs: (() => {
        let next = 3000;
        return () => next++;
      })(),
      turnRunIdFactory: () => "turn-run-policy",
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });

    const started = firstRegistry.start({
      turnId: "turn-policy",
      input: createInput({ sessionKey: "session-policy", messageId: "message-policy" }),
      policyEnvelopeRefs: ["policy-ref-run-start"],
    });
    firstRegistry.appendEvent(started.turnRunId, {
      kind: "runtime.tool",
      summary: "external tool gated",
      policyEnvelopeRefs: ["policy-ref-tool-dispatch"],
      metadata: {
        toolName: "media_analyzer",
      },
    });
    firstRegistry.finalize(started.turnRunId, {
      status: "completed",
      userVisibleSummary: "完成",
      policyEnvelopeRefs: ["policy-ref-evidence-admission"],
    });

    const secondRegistry = createConversationRunRegistry({
      nowMs: () => 4000,
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });
    const reloaded = secondRegistry.read("turn-run-policy");

    expect(reloaded).toMatchObject({
      policyEnvelopeRefs: [
        "policy-ref-run-start",
        "policy-ref-tool-dispatch",
        "policy-ref-evidence-admission",
      ],
      events: [
        expect.objectContaining({
          policyEnvelopeRefs: ["policy-ref-tool-dispatch"],
          metadata: expect.objectContaining({
            toolName: "media_analyzer",
          }),
        }),
      ],
    });
  });

  it("marks persisted active runs stale on registry restart instead of treating them as live", () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-run-registry-stale-"));
    tempRoots.push(root);
    const storePath = join(root, "runs.json");
    const firstRegistry = createConversationRunRegistry({
      nowMs: () => 1000,
      turnRunIdFactory: () => "turn-run-stale",
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });

    firstRegistry.start({
      turnId: "turn-stale",
      input: createInput({ sessionKey: "session-stale", messageId: "message-stale" }),
      status: "running",
      activeModelCall: "model-call-stale",
      activeToolCalls: ["tool-call-stale"],
      activeSubagentRunIds: ["delegate-stale"],
    });

    const secondRegistry = createConversationRunRegistry({
      nowMs: () => 2000,
      store: createFileConversationRunRegistryStore({ path: storePath }),
    });
    const recovered = secondRegistry.read("turn-run-stale");

    expect(recovered).toMatchObject({
      status: "cancelled",
      endedAtMs: 2000,
      stopRequestedBy: "system",
      stopReason: "stale conversation run recovered after runtime restart",
      metadata: expect.objectContaining({
        staleRecovered: true,
        staleRecoveredFromStatus: "running",
      }),
    });
    expect(secondRegistry.list({ sessionKey: "session-stale", status: "running" })).toHaveLength(0);
    expect(recovered?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.stale_recovered",
          summary: "Stale active conversation run was marked cancelled after runtime restart.",
        }),
      ]),
    );
  });

  it("marks active runs stuck when there has been no non-diagnostic activity", () => {
    let now = 1000;
    const registry = createConversationRunRegistry({
      nowMs: () => now,
      turnRunIdFactory: () => "turn-run-stuck",
    });

    const started = registry.start({
      turnId: "turn-stuck",
      input: createInput({ sessionKey: "session-stuck", messageId: "message-stuck" }),
      status: "running",
      activeModelCall: "model-call-stuck",
      activeToolCalls: ["tool-call-stuck"],
    });
    now = 1200;
    registry.appendEvent(started.turnRunId, {
      kind: "runtime.tool",
      summary: "tool started",
    });
    now = 1901;

    const stuck = registry.markStuckRuns({ staleAfterMs: 500 });
    const repeated = registry.markStuckRuns({ staleAfterMs: 500 });
    const recovered = registry.read(started.turnRunId);

    expect(stuck).toHaveLength(1);
    expect(repeated).toHaveLength(0);
    expect(recovered).toMatchObject({
      status: "running",
      metadata: expect.objectContaining({
        stuckWarningActive: true,
        stuckWarningLastActivityAtMs: 1200,
      }),
    });
    expect(recovered?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.stuck_warning",
          summary: "Conversation run has had no activity past the stuck threshold.",
          metadata: expect.objectContaining({
            idleForMs: 701,
            thresholdMs: 500,
            status: "running",
            activeToolCalls: ["tool-call-stuck"],
            activeModelCall: "model-call-stuck",
          }),
        }),
      ]),
    );
  });

  it("does not mark recent or completed runs stuck", () => {
    let now = 2000;
    const registry = createConversationRunRegistry({
      nowMs: () => now,
      turnRunIdFactory: ({ turnId }) => `${turnId}:run`,
    });

    const active = registry.start({
      turnId: "turn-recent",
      input: createInput({ sessionKey: "session-stuck", messageId: "message-recent" }),
      status: "running",
    });
    const completed = registry.start({
      turnId: "turn-completed",
      input: createInput({ sessionKey: "session-stuck", messageId: "message-completed" }),
      status: "running",
    });
    now = 2200;
    registry.appendEvent(active.turnRunId, {
      kind: "runtime.trace",
      summary: "recent activity",
    });
    registry.finalize(completed.turnRunId, {
      status: "completed",
      userVisibleSummary: "完成",
    });
    now = 2500;

    expect(registry.markStuckRuns({ staleAfterMs: 500 })).toEqual([]);
  });

  it("marks a run as stopping through the unified stop API", () => {
    const controller = new AbortController();
    const registry = createConversationRunRegistry({
      nowMs: () => 500,
      turnRunIdFactory: () => "turn-run-stop",
    });
    registry.start({ turnId: "turn-stop", input: createInput(), abortController: controller });

    const stopped = registry.stop("turn-run-stop", {
      requestedBy: "user",
      reason: "desktop-stop-button",
    });

    expect(stopped.status).toBe("stopping");
    expect(stopped.stopRequestedBy).toBe("user");
    expect(stopped.stopReason).toBe("desktop-stop-button");
    expect(controller.signal.aborted).toBe(true);
  });

  it("tracks active subagent runs so parent stop can cascade cancellation", () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 700,
      turnRunIdFactory: () => "turn-run-parent",
    });
    registry.start({ turnId: "turn-parent", input: createInput() });

    const registered = registry.registerSubagentRun("turn-run-parent", "delegate-child-1");
    const stopped = registry.stop("turn-run-parent", {
      requestedBy: "user",
      reason: "desktop-stop-button",
    });

    expect(registered.activeSubagentRunIds).toEqual(["delegate-child-1"]);
    expect(stopped.activeSubagentRunIds).toEqual(["delegate-child-1"]);
    expect(registry.read("turn-run-parent")?.activeSubagentRunIds).toEqual(["delegate-child-1"]);
  });

  it("registers runtime turns and exposes the turnRunId in the result", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 900,
      turnRunIdFactory: () => "turn-run-runtime",
    });

    const result = await runConversationRuntimeTurn(createInput(), {
      runRegistry: registry,
      turnIdFactory: () => "turn-runtime",
      nowMs: () => 900,
      orchestrate: () => createTurnDecision(),
      resolveCapabilityContext: () => ({
        status: "hit",
        hits: [
          {
            id: "memory:working-memory:mempalace:opening-style",
            source: "memory",
            status: "hit",
            metadata: {
              providerId: "weixin-working-memory",
              providerKind: "mempalace",
              directStoreAccessAllowed: false,
            },
          },
        ],
      }),
      callModel: async () => ({ finalText: "你好" }),
      executeTool: async ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "",
      }),
    });

    expect(result.turnRunId).toBe("turn-run-runtime");
    expect(result.events).toMatchObject([{ kind: "runtime.final" }]);
    expect(registry.read("turn-run-runtime")?.status).toBe("completed");
    expect(registry.read("turn-run-runtime")?.userVisibleSummary).toBe("你好");
    expect(registry.read("turn-run-runtime")?.metadata).toMatchObject({
      capabilityPacket: {
        hits: [
          expect.objectContaining({
            id: "memory:working-memory:mempalace:opening-style",
            metadata: expect.objectContaining({
              providerId: "weixin-working-memory",
              providerKind: "mempalace",
              directStoreAccessAllowed: false,
            }),
          }),
        ],
      },
    });
  });

  it("registers delegated subagent runs as soon as agent.delegate returns", async () => {
    const registry = createConversationRunRegistry({
      nowMs: () => 950,
      turnRunIdFactory: () => "turn-run-delegate",
    });
    const observedBeforeSecondModelTurn: string[][] = [];
    let modelCallCount = 0;

    await runConversationRuntimeTurn(createInput(), {
      runRegistry: registry,
      turnIdFactory: () => "turn-delegate",
      nowMs: () => 950,
      orchestrate: () => createTurnDecision(),
      resolveCapabilityContext: () => ({
        status: "hit",
        hits: [],
      }),
      tools: [
        {
          name: "agent.delegate",
          description: "delegate to a subagent",
          readOnly: false,
        },
      ],
      authorizeToolCall: ({ defaultDecision }) => ({
        ...defaultDecision,
        status: "allow",
      }),
      preflightToolSandbox: () => ({
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-11T00:00:00.000Z",
        providerId: "unit-test",
        reason: "unit test allows agent.delegate",
      }),
      callModel: async () => {
        modelCallCount += 1;
        if (modelCallCount === 1) {
          return {
            toolCalls: [
              {
                id: "call-agent-delegate-1",
                name: "agent.delegate",
                args: {
                  task: "研究停止级联",
                  expectedOutput: "结论",
                },
              },
            ],
          };
        }
        observedBeforeSecondModelTurn.push([
          ...(registry.read("turn-run-delegate")?.activeSubagentRunIds ?? []),
        ]);
        return { finalText: "子委托已登记" };
      },
      executeTool: async ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content: "status: queued",
        metadata: {
          delegationId: "delegate-child-1",
          subagentRun: {
            subagentId: "delegate-child-1",
          },
        },
      }),
    });

    expect(observedBeforeSecondModelTurn).toEqual([["delegate-child-1"]]);
    expect(registry.read("turn-run-delegate")?.activeSubagentRunIds).toEqual(["delegate-child-1"]);
  });
});
