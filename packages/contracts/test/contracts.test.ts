import { describe, expect, it } from "vitest";

import {
  CONTRACTS_SCHEMA_VERSION,
  type ChannelCapability,
  type ContextSection,
  ContractError,
  type EngineInput,
  type EngineResult,
  type EngineRuntimePorts,
  type ExecutionPolicy,
  type RecallBlock,
  type RuntimeContext,
  type SessionContract,
  type TaskContract,
  type TurnContract,
  type TurnStepContract,
  createAuditEvent,
  createChannelDeliveryResult,
  createChannelSessionTarget,
  createChannelTransportEnvelope,
  createContractError,
  createExecutionPolicy,
  createRuntimeDegradeSurface,
  createRuntimeErrorSurface,
  createRuntimeEvent,
  createStreamEvent,
  decideReasoningStrategy,
  resolveRuntimeFailureKindForCode,
  resolveRuntimeRecoveryActionForKind,
  toContractError,
  toLegacyReasoningNextAction,
} from "../src/index.js";

describe("contracts package", () => {
  it("decides plan-execute strategy for high complexity work", () => {
    const task: TaskContract = {
      id: "task_1",
      sessionId: "session_1",
      kind: "analysis",
      status: "running",
      priority: "urgent",
      retries: 0,
      createdAtMs: 1,
      updatedAtMs: 2,
    };

    const decision = decideReasoningStrategy({
      task,
      model: {
        id: "gpt-5",
        provider: "openai",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsStreaming: true,
      },
    });

    expect(decision.strategy).toBe("plan-execute");
    expect(decision.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(decision.suggestedAction.type).toBe("model");
  });

  it("maps phase 2 action semantics to legacy next actions", () => {
    expect(toLegacyReasoningNextAction({ type: "model" })).toBe("respond");
    expect(toLegacyReasoningNextAction({ type: "tool" })).toBe("call-tool");
    expect(toLegacyReasoningNextAction({ type: "final" })).toBe("respond");
    expect(toLegacyReasoningNextAction({ type: "abort" })).toBe("abort");
    expect(toLegacyReasoningNextAction({ type: "pause" })).toBe("defer");
    expect(toLegacyReasoningNextAction({ type: "delegate" })).toBe("defer");
  });

  it("supports channel transport, target, and delivery contracts", () => {
    const capability: ChannelCapability = {
      channel: "webchat",
      supportsDirect: true,
      supportsThreads: true,
      supportsStreaming: false,
      supportsAttachments: false,
    };
    const target = createChannelSessionTarget({
      sessionKey: "agent:agent-main:direct:user_1",
      ownership: {
        agentId: "agent-main",
        channel: "webchat",
        routeKind: "direct",
        peerId: "user_1",
      },
    });
    const envelope = createChannelTransportEnvelope({
      channel: "webchat",
      agentId: "agent-main",
      peerId: "user_1",
      messageId: "msg_1",
      receivedAtMs: 10,
      routingHint: {
        agentId: "agent-main",
        channel: "webchat",
        routeKind: "direct",
        peerId: "user_1",
      },
      text: "hello",
    });
    const delivery = createChannelDeliveryResult({
      channel: "webchat",
      status: "accepted",
      processedAtMs: 20,
      routeKind: "direct",
      sessionKey: target.sessionKey,
    });

    expect(capability.supportsThreads).toBe(true);
    expect(target.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(envelope.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(delivery.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
  });

  it("creates runtime event with schema version", () => {
    const context: RuntimeContext = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      requestId: "request_1",
      surface: "session",
      identifiers: {
        sessionId: "session_1",
      },
      startedAtMs: Date.now(),
    };

    const session: SessionContract = {
      id: "session_1",
      state: "open",
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };

    const event = createRuntimeEvent({
      id: "evt_1",
      kind: "session.started",
      occurredAtMs: Date.now(),
      context,
      payload: { session },
    });

    expect(event.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(event.payload.session.id).toBe("session_1");
  });

  it("creates stream chunk event", () => {
    const streamEvent = createStreamEvent({
      id: "stream_1",
      kind: "stream.chunk",
      occurredAtMs: Date.now(),
      payload: {
        turnId: "turn_1",
        index: 0,
        delta: "hello",
      },
    });

    expect(streamEvent.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(streamEvent.payload.delta).toBe("hello");
  });

  it("creates audit and execution policy contracts with defaulted eligibility", () => {
    const context: RuntimeContext = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      requestId: "request_audit",
      surface: "tool",
      identifiers: {
        sessionId: "session_audit",
      },
      startedAtMs: Date.now(),
    };

    const auditEvent = createAuditEvent({
      id: "audit_1",
      kind: "policy.decision",
      actor: "policy-runtime",
      severity: "info",
      occurredAtMs: Date.now(),
      context,
      target: "filesystem.read_text",
      summary: "policy allow",
    });
    const policy = createExecutionPolicy({
      verdict: "degrade",
      reason: "tool allowed in reduced mode",
      riskLevel: "read-only",
    });

    expect(auditEvent.schemaVersion).toBe(CONTRACTS_SCHEMA_VERSION);
    expect(auditEvent.actor).toBe("policy-runtime");
    expect(policy.eligibility.canRetry).toBe(false);
    expect(policy.eligibility.canFailover).toBe(false);
    expect(policy.eligibility.canDegrade).toBe(true);
  });

  it("supports context sections and recall blocks on prompt envelopes", () => {
    const section: ContextSection = {
      id: "working-memory",
      owner: "memory",
      cacheBucket: "dynamic",
      content: "recent steps",
      priority: 80,
      trustLevel: "trusted",
    };
    const recallBlock: RecallBlock = {
      blockId: "recall_1",
      strategy: "lexical",
      scope: "session",
      items: [
        {
          id: "memory_1",
          content: "important memory",
          score: 0.91,
        },
      ],
    };

    const prompt: EngineInput["prompt"] = {
      templateId: "default",
      messages: [{ role: "user", content: "Ping" }],
      sections: [section],
      recallBlocks: [recallBlock],
    };

    expect(prompt.sections?.[0]?.owner).toBe("memory");
    expect(prompt.recallBlocks?.[0]?.strategy).toBe("lexical");
  });

  it("wraps unknown errors into ContractError", () => {
    const wrapped = toContractError(new Error("boom"), "MODEL_FAILURE");

    expect(wrapped).toBeInstanceOf(ContractError);
    expect(wrapped.code).toBe("MODEL_FAILURE");
    expect(wrapped.message).toBe("boom");
  });

  it("supports turn completion runtime event shape", () => {
    const turn: TurnContract = {
      id: "turn_1",
      sessionId: "session_1",
      index: 1,
      startedAtMs: Date.now(),
      input: {
        role: "user",
        content: "hi",
        timestampMs: Date.now(),
      },
      output: {
        role: "assistant",
        content: "hello",
        timestampMs: Date.now(),
      },
    };

    const context: RuntimeContext = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      requestId: "request_2",
      surface: "turn",
      identifiers: {
        sessionId: "session_1",
        turnId: "turn_1",
      },
      startedAtMs: Date.now(),
    };

    const event = createRuntimeEvent({
      id: "evt_2",
      kind: "turn.completed",
      occurredAtMs: Date.now(),
      context,
      payload: { turn },
    });

    expect(event.kind).toBe("turn.completed");
    expect(event.payload.turn.output?.content).toBe("hello");
  });

  it("supports turn-step metadata and runtime degrade events", () => {
    const now = Date.now();
    const step: TurnStepContract = {
      id: "step_1",
      index: 0,
      kind: "tool",
      status: "completed",
      action: "tool",
      startedAtMs: now,
      endedAtMs: now + 10,
      toolCallId: "call_1",
      metadata: {
        attempt: 1,
      },
    };

    const turn: TurnContract = {
      id: "turn_steps",
      sessionId: "session_1",
      index: 2,
      startedAtMs: now,
      currentStepId: step.id,
      steps: [step],
      input: {
        role: "user",
        content: "run tool",
        timestampMs: now,
      },
    };

    const context: RuntimeContext = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      requestId: "request_steps",
      surface: "reasoning",
      identifiers: {
        sessionId: "session_1",
        turnId: "turn_steps",
        stepId: "step_1",
      },
      startedAtMs: now,
    };

    const turnStepEvent = createRuntimeEvent({
      id: "evt_step",
      kind: "turn.step.completed",
      occurredAtMs: now + 10,
      context,
      payload: {
        turn,
        step,
      },
    });

    const degradedStreamEvent = createStreamEvent({
      id: "stream_degraded",
      kind: "stream.degraded",
      occurredAtMs: now + 11,
      payload: {
        turnId: turn.id,
        degradation: {
          stage: "tool",
          category: "tool",
          action: "degrade",
          severity: "minor",
          reason: "fallback",
          message: "tool timeout, using cached response",
          recoverable: true,
        },
      },
    });

    expect(turnStepEvent.kind).toBe("turn.step.completed");
    expect(turnStepEvent.payload.step.toolCallId).toBe("call_1");
    expect(degradedStreamEvent.kind).toBe("stream.degraded");
    expect(degradedStreamEvent.payload.degradation.recoverable).toBe(true);
  });

  it("exposes phase 1 runtime interface shapes", async () => {
    const runContext = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      requestId: "request_3",
      surface: "runtime" as const,
      identifiers: { sessionId: "session_2" },
      startedAtMs: Date.now(),
      runId: "run_1",
      attempt: 1,
    };

    const input: EngineInput = {
      context: runContext,
      session: {
        id: "session_2",
        state: "open",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
      task: {
        id: "task_2",
        sessionId: "session_2",
        kind: "reply",
        status: "running",
        priority: "normal",
        retries: 0,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
      prompt: {
        templateId: "default",
        messages: [{ role: "user", content: "Ping" }],
      },
      model: {
        id: "gpt-5-mini",
        provider: "openai",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsStreaming: true,
      },
      stream: true,
    };

    const reasoning = {
      decision: decideReasoningStrategy({}),
      action: {
        type: "model" as const,
      },
      nextAction: "respond" as const,
      shouldStream: true,
      shouldCallTool: false,
      step: {
        id: "step_2",
        index: 0,
        startedAtMs: Date.now(),
      },
      degradation: {
        stage: "runtime" as const,
        category: "runtime" as const,
        action: "degrade" as const,
        severity: "minor" as const,
        reason: "latency-budget" as const,
        message: "responding under reduced context",
        recoverable: true,
      },
    };

    const result: EngineResult = {
      status: "completed",
      context: runContext,
      output: {
        role: "assistant",
        content: "Pong",
        timestampMs: Date.now(),
      },
      reasoning,
      toolResults: [],
      runtimeEvents: [],
      streamEvents: [],
    };

    const ports: EngineRuntimePorts = {
      sessionManager: {
        async get() {
          return input.session;
        },
        async save() {},
        async appendToolCall() {},
        async touch() {},
      },
      journal: {
        async append() {},
        async appendMany() {},
        async listByRun() {
          return [];
        },
      },
      emitter: {
        async emit() {},
        async complete() {},
      },
      memory: {
        async read() {
          return null;
        },
        async write() {},
        async search() {
          return [];
        },
      },
      model: {
        async generate() {
          return {
            invocation: {
              invocationId: "inv_1",
              model: input.model,
            },
            output: result.output,
            finishReason: "stop",
          };
        },
      },
      tool: {
        async execute(call) {
          return {
            call,
            success: true,
            startedAtMs: Date.now(),
            finishedAtMs: Date.now(),
            output: { ok: true },
          };
        },
      },
      policy: {
        async evaluatePrompt() {
          return createExecutionPolicy({
            verdict: "allow",
            reason: "prompt approved",
            eligibility: {
              canRetry: false,
              canFailover: false,
              canDegrade: false,
            },
          }) satisfies ExecutionPolicy;
        },
        async evaluateToolCall() {
          return createExecutionPolicy({
            verdict: "allow",
            reason: "tool approved",
          }) satisfies ExecutionPolicy;
        },
        async evaluateOutput() {
          return createExecutionPolicy({
            verdict: "allow",
            reason: "output approved",
          }) satisfies ExecutionPolicy;
        },
      },
      contextAssembler: {
        async assemble() {
          return {
            prompt: input.prompt,
            sections: input.prompt.sections,
            recallBlocks: input.prompt.recallBlocks,
            memory: [],
          };
        },
      },
    };

    await ports.emitter.complete(result);
    expect(result.output?.content).toBe("Pong");
  });

  it("maps runtime failure kinds and actions from contract codes", () => {
    expect(resolveRuntimeFailureKindForCode("PROVIDER_TRANSIENT_ERROR")).toBe("provider-transient");
    expect(resolveRuntimeRecoveryActionForKind("provider-transient")).toBe("failover");
    expect(resolveRuntimeFailureKindForCode("MEMORY_DEGRADED")).toBe("memory-degrade");
    expect(resolveRuntimeRecoveryActionForKind("memory-degrade")).toBe("degrade");
  });

  it("creates structured runtime failure and degradation helpers", () => {
    const providerError = createContractError({
      code: "PROVIDER_FATAL_ERROR",
      message: "unauthorized",
      retryable: false,
    });
    const failure = createRuntimeErrorSurface({
      stage: "model",
      error: providerError,
      operatorVisible: true,
    });
    const degradation = createRuntimeDegradeSurface({
      stage: "runtime",
      category: "memory",
      severity: "minor",
      reason: "fallback",
      message: "memory recall skipped",
      recoverable: true,
    });

    expect(failure.kind).toBe("provider-fatal");
    expect(failure.action).toBe("abort");
    expect(failure.operatorVisible).toBe(true);
    expect(degradation.category).toBe("memory");
    expect(degradation.action).toBe("degrade");
  });
});
