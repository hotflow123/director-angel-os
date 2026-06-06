import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "../src/adapters/fake-provider.js";
import {
  ModelProviderError,
  createHttpModelProviderError,
  planModelProviderFallback,
  toModelProviderRuntimeFailureSurface,
} from "../src/provider-errors.js";
import { InMemoryModelProviderRegistry, ModelRuntime } from "../src/runtime.js";

describe("ModelRuntime", () => {
  it("dispatches generate to the selected provider", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(new FakeModelProvider({ id: "fake-a", cannedText: "ok" }));
    const runtime = new ModelRuntime(registry);

    const result = await runtime.generate({
      providerId: "fake-a",
      request: {
        model: "fake-model",
        messages: [{ role: "user", content: "ping" }],
      },
    });

    expect(result.text).toBe("ok");
  });

  it("normalizes streamed events from provider output", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(new FakeModelProvider({ id: "fake-b", cannedText: "abc" }));
    const runtime = new ModelRuntime(registry);

    const normalizedTypes = [];
    for await (const event of runtime.streamNormalized({
      providerId: "fake-b",
      request: {
        model: "fake-model",
        messages: [{ role: "user", content: "ping" }],
      },
    })) {
      normalizedTypes.push(event.type);
    }

    expect(normalizedTypes).toEqual(["response_started", "text_delta", "response_completed"]);
  });

  it("adapts normalized provider stream to contract stream events", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(new FakeModelProvider({ id: "fake-c", cannedText: "abc" }));
    const runtime = new ModelRuntime(registry);

    const contractKinds = [];
    for await (const event of runtime.streamAsContractEvents(
      {
        turnId: "turn_runtime_1",
        providerId: "fake-c",
        request: {
          model: "fake-model",
          messages: [{ role: "user", content: "ping" }],
        },
      },
      {
        now: () => 123,
      },
    )) {
      contractKinds.push(event.kind);
    }

    expect(contractKinds).toEqual(["stream.started", "stream.chunk", "stream.completed"]);
  });

  it("preserves interruption and resume semantics when adapting provider streams", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register({
      id: "pause-provider",
      async generate() {
        return { text: "not used" };
      },
      async *stream() {
        yield { type: "response.started" } as const;
        yield { type: "text.delta", text: "draft" } as const;
        yield { type: "response.paused", reason: "tool_boundary" } as const;
        yield { type: "response.resumed" } as const;
        yield { type: "text.delta", text: "done" } as const;
        yield { type: "response.completed", finishReason: "stop" } as const;
      },
    });
    const runtime = new ModelRuntime(registry);

    const contractKinds = [];
    for await (const event of runtime.streamAsContractEvents(
      {
        turnId: "turn_runtime_pause_resume",
        providerId: "pause-provider",
        request: {
          model: "fake-model",
          messages: [{ role: "user", content: "ping" }],
        },
      },
      {
        now: () => 222,
      },
    )) {
      contractKinds.push(event.kind);
    }

    expect(contractKinds).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.interrupted",
      "stream.resumed",
      "stream.chunk",
      "stream.completed",
    ]);
  });

  it("exposes contract event envelopes for stable persistence metadata", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(new FakeModelProvider({ id: "fake-d", cannedText: "hello" }));
    const runtime = new ModelRuntime(registry);

    const envelopes = [];
    for await (const envelope of runtime.streamAsContractEventEnvelopes(
      {
        turnId: "turn_runtime_2",
        providerId: "fake-d",
        request: {
          model: "fake-model",
          messages: [{ role: "user", content: "ping" }],
        },
      },
      {
        now: () => 456,
      },
    )) {
      envelopes.push(envelope);
    }

    expect(envelopes.map((envelope) => envelope.sequence)).toEqual([0, 1, 2]);
    expect(envelopes.map((envelope) => envelope.chunkIndex)).toEqual([0, 0, 1]);
    expect(envelopes.map((envelope) => envelope.event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(envelopes[2]?.terminal).toBe(true);
  });

  it("preserves fatal provider failures when adapting runtime streams to contract events", async () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register({
      id: "fatal-provider",
      async generate() {
        throw new Error("not used");
      },
      async *stream() {
        yield* [];
        throw new ModelProviderError({
          providerId: "fatal-provider",
          stage: "stream",
          code: "HTTP_4XX",
          message: "unauthorized",
          statusCode: 401,
          retryable: false,
        });
      },
    });
    const runtime = new ModelRuntime(registry);

    const contractEvents = [];
    for await (const event of runtime.streamAsContractEvents(
      {
        turnId: "turn_runtime_fatal",
        providerId: "fatal-provider",
        request: {
          model: "gpt-stub",
          messages: [{ role: "user", content: "ping" }],
        },
      },
      {
        now: () => 789,
      },
    )) {
      contractEvents.push(event);
    }

    expect(contractEvents.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.error",
      "stream.aborted",
    ]);
    expect(contractEvents[1]?.payload).toMatchObject({
      error: {
        code: "PROVIDER_FAILURE",
        retryable: false,
      },
    });
  });

  it("classifies provider runtime failures into kind and action", () => {
    const transient = toModelProviderRuntimeFailureSurface(
      new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      }),
    );
    const fatal = toModelProviderRuntimeFailureSurface(
      new ModelProviderError({
        providerId: "openai-live",
        stage: "stream",
        code: "HTTP_4XX",
        message: "unauthorized",
        statusCode: 401,
        retryable: false,
      }),
    );

    expect(transient).toMatchObject({
      kind: "provider-transient",
      action: "failover",
      failureClass: "transient",
      providerCode: "HTTP_429",
      operatorVisible: false,
      error: {
        metadata: {
          stage: "model",
          kind: "provider-transient",
          action: "failover",
          recoverable: true,
        },
      },
    });
    expect(fatal).toMatchObject({
      stage: "stream",
      kind: "provider-fatal",
      action: "abort",
      failureClass: "fatal",
      providerCode: "HTTP_4XX",
      operatorVisible: true,
      error: {
        metadata: {
          stage: "stream",
          kind: "provider-fatal",
          action: "abort",
          recoverable: false,
          operatorVisible: true,
        },
      },
    });
  });

  it("plans provider fallback with unhealthy TTL and no secret leakage", () => {
    const nowMs = Date.parse("2026-05-17T00:00:00.000Z");
    const plan = planModelProviderFallback({
      requestedProviderId: "primary-provider",
      fallbackProviderIds: ["fallback-a", "fallback-b"],
      nowMs,
      unhealthyProviders: {
        "fallback-a": {
          providerId: "fallback-a",
          unhealthyUntilMs: nowMs + 30_000,
          reason: "previous rate limit",
        },
      },
      lastFailure: createHttpModelProviderError({
        providerId: "primary-provider",
        stage: "generate",
        statusCode: 429,
        message: "rate limited sk-secret-value",
      }),
    });

    expect(plan).toMatchObject({
      schemaVersion: "models.provider-fallback-plan.v1",
      status: "ready",
      requestedProviderId: "primary-provider",
      selectedProviderId: "fallback-b",
      usedFallback: true,
      unhealthyTtlMs: 60_000,
      failure: {
        providerId: "primary-provider",
        code: "HTTP_429",
        statusCode: 429,
        retryable: true,
        failureClass: "transient",
        unhealthyUntilMs: nowMs + 60_000,
      },
      reasonCodes: expect.arrayContaining([
        "provider_failure_transient",
        "requested_provider_marked_unhealthy",
        "skipped_unhealthy_provider",
        "selected_fallback_provider",
      ]),
    });
    expect(plan.attempts.map((attempt) => attempt.providerId)).toEqual([
      "primary-provider",
      "fallback-a",
      "fallback-b",
    ]);
    expect(plan.attempts.map((attempt) => attempt.status)).toEqual(["blocked", "skipped", "ready"]);
    expect(JSON.stringify(plan)).not.toContain("sk-secret-value");
  });

  it("blocks fallback on fatal provider failures and classifies payment/auth separately", () => {
    const nowMs = Date.parse("2026-05-17T00:00:00.000Z");
    const paymentPlan = planModelProviderFallback({
      requestedProviderId: "primary-provider",
      fallbackProviderIds: ["fallback-a"],
      nowMs,
      lastFailure: createHttpModelProviderError({
        providerId: "primary-provider",
        stage: "generate",
        statusCode: 402,
        message: "payment required",
      }),
    });
    const authPlan = planModelProviderFallback({
      requestedProviderId: "primary-provider",
      fallbackProviderIds: ["fallback-a"],
      nowMs,
      lastFailure: createHttpModelProviderError({
        providerId: "primary-provider",
        stage: "generate",
        statusCode: 401,
        message: "unauthorized",
      }),
    });

    expect(paymentPlan).toMatchObject({
      status: "blocked",
      selectedProviderId: undefined,
      failure: {
        code: "HTTP_402",
        failureClass: "fatal",
      },
      reasonCodes: expect.arrayContaining(["provider_failure_fatal", "payment_required"]),
      nextActions: expect.arrayContaining([
        "resolve provider billing or choose a different requested provider explicitly",
      ]),
    });
    expect(authPlan).toMatchObject({
      status: "blocked",
      selectedProviderId: undefined,
      failure: {
        code: "HTTP_401",
        failureClass: "fatal",
      },
      reasonCodes: expect.arrayContaining(["provider_failure_fatal", "auth_failed"]),
      nextActions: expect.arrayContaining([
        "fix provider credentials before retrying this provider chain",
      ]),
    });
  });
});
