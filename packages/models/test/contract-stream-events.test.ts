import { describe, expect, it } from "vitest";

import {
  adaptStreamEventToContractEvent,
  adaptStreamToContractEventEnvelopes,
  adaptStreamToContractEvents,
  createContractFailureEventEnvelopes,
  observeContractStreamEvent,
  summarizeContractStreamEvents,
} from "../src/contract-stream-events.js";
import { ModelProviderError } from "../src/provider-errors.js";

describe("adaptStreamEventToContractEvent", () => {
  it("maps model stream events into contract stream kinds", () => {
    const started = adaptStreamEventToContractEvent({
      turnId: "turn_1",
      source: {
        type: "response_started",
        providerId: "fake",
      },
      sequence: 0,
      chunkIndex: 0,
      occurredAtMs: 100,
      eventId: "evt_1",
    });

    const chunk = adaptStreamEventToContractEvent({
      turnId: "turn_1",
      source: {
        type: "text_delta",
        providerId: "fake",
        text: "hello",
      },
      sequence: 1,
      chunkIndex: started.nextChunkIndex,
      occurredAtMs: 101,
      eventId: "evt_2",
    });

    const toolCall = adaptStreamEventToContractEvent({
      turnId: "turn_1",
      source: {
        type: "tool_boundary",
        providerId: "fake",
        toolCall: {
          id: "call_1",
          name: "filesystem.read_text",
          argumentsJson: '{"path":"README.md"}',
        },
      },
      sequence: 2,
      chunkIndex: chunk.nextChunkIndex,
      occurredAtMs: 102,
      eventId: "evt_3",
    });

    const completed = adaptStreamEventToContractEvent({
      turnId: "turn_1",
      source: {
        type: "response_completed",
        providerId: "fake",
        finishReason: "length",
      },
      sequence: 3,
      chunkIndex: toolCall.nextChunkIndex,
      occurredAtMs: 103,
      eventId: "evt_4",
    });

    expect(started.event.kind).toBe("stream.started");
    expect(chunk.event.kind).toBe("stream.chunk");
    expect(chunk.event.payload).toMatchObject({ turnId: "turn_1", index: 0, delta: "hello" });
    expect(toolCall.event.kind).toBe("stream.tool-call");
    expect(toolCall.event.payload.call.toolName).toBe("filesystem.read_text");
    expect(completed.event.kind).toBe("stream.completed");
    expect(completed.event.payload.finishReason).toBe("length");
  });

  it("maps pause/resume/abort into interruption-aware contract events", () => {
    const paused = adaptStreamEventToContractEvent({
      turnId: "turn_2",
      source: {
        type: "response_paused",
        providerId: "fake",
        reason: "rate_limit",
      },
      sequence: 1,
      chunkIndex: 0,
      occurredAtMs: 201,
    });
    const resumed = adaptStreamEventToContractEvent({
      turnId: "turn_2",
      source: {
        type: "response_resumed",
        providerId: "fake",
      },
      sequence: 2,
      chunkIndex: 0,
      occurredAtMs: 202,
    });
    const aborted = adaptStreamEventToContractEvent({
      turnId: "turn_2",
      source: {
        type: "response_aborted",
        providerId: "fake",
        error: "provider timeout",
      },
      sequence: 3,
      chunkIndex: 0,
      occurredAtMs: 203,
    });

    expect(paused.event.kind).toBe("stream.interrupted");
    expect(paused.event.payload).toMatchObject({
      turnId: "turn_2",
      reason: "rate_limit",
      resumable: true,
    });
    expect(resumed.event.kind).toBe("stream.resumed");
    expect(resumed.event.payload).toMatchObject({
      turnId: "turn_2",
      reason: "response resumed",
    });
    expect(aborted.event.kind).toBe("stream.aborted");
    expect(aborted.event.payload.failure.error.code).toBe("ABORTED");
  });
});

describe("adaptStreamToContractEvents", () => {
  it("keeps chunk index monotonic across non-chunk events", async () => {
    const source = [
      { type: "response_started", providerId: "fake" } as const,
      { type: "text_delta", providerId: "fake", text: "a" } as const,
      { type: "status_delta", providerId: "fake", status: "planning" } as const,
      { type: "text_delta", providerId: "fake", text: "b" } as const,
      { type: "response_completed", providerId: "fake", finishReason: "stop" } as const,
    ];

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_3", source, {
      now: () => 300,
      eventIdFactory(input) {
        return `evt_${input.sequence}`;
      },
    })) {
      events.push(event);
    }

    const chunks = events.filter((event) => event.kind === "stream.chunk");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.payload).toMatchObject({ index: 0, delta: "a" });
    expect(chunks[1]?.payload).toMatchObject({ index: 1, delta: "b" });
    expect(events.map((event) => event.id)).toEqual(["evt_0", "evt_1", "evt_2", "evt_3", "evt_4"]);
  });

  it("preserves interruption and resume boundaries without inventing step ids", async () => {
    const source = [
      { type: "response_started", providerId: "fake" } as const,
      { type: "text_delta", providerId: "fake", text: "draft" } as const,
      { type: "response_paused", providerId: "fake", reason: "tool_boundary" } as const,
      { type: "response_resumed", providerId: "fake" } as const,
      { type: "text_delta", providerId: "fake", text: "done" } as const,
      { type: "response_completed", providerId: "fake", finishReason: "stop" } as const,
    ];

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_pause_resume", source, {
      now: () => 320,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.interrupted",
      "stream.resumed",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(events[2]?.payload).toMatchObject({
      turnId: "turn_pause_resume",
      reason: "tool_boundary",
      resumable: true,
    });
    expect(events[3]?.payload).toMatchObject({
      turnId: "turn_pause_resume",
      reason: "response resumed",
    });
  });

  it("synthesizes boundary events when provider stream misses started/completed", async () => {
    const source = [{ type: "text_delta", providerId: "fake", text: "only" }] as const;

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_4", source, {
      now: () => 400,
      eventIdFactory(input) {
        return `evt_${input.sequence}_${input.sourceType}`;
      },
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(events[1]?.payload).toMatchObject({ index: 0, delta: "only" });
    expect(events.map((event) => event.id)).toEqual([
      "evt_0_synthetic.started",
      "evt_1_text_delta",
      "evt_2_synthetic.completed",
    ]);
  });

  it("emits stream.error and stream.aborted when upstream stream throws", async () => {
    async function* brokenStream() {
      yield { type: "response_started", providerId: "fake" } as const;
      yield { type: "text_delta", providerId: "fake", text: "partial" } as const;
      throw new Error("upstream exploded");
    }

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_5", brokenStream(), {
      now: () => 500,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.error",
      "stream.aborted",
    ]);
    expect(events[2]?.payload).toMatchObject({
      turnId: "turn_5",
      error: {
        code: "INVALID_STREAM_EVENT",
        message: "upstream exploded",
      },
    });
    expect(events[3]?.payload).toMatchObject({
      turnId: "turn_5",
      failure: {
        error: {
          code: "ABORTED",
        },
      },
    });
  });

  it("marks synthetic stream failures as retryable when upstream error is retryable", async () => {
    async function* retryableBrokenStream() {
      yield { type: "response_started", providerId: "fake" } as const;
      throw Object.assign(new Error("provider overloaded"), { retryable: true });
    }

    const events = [];
    for await (const event of adaptStreamToContractEvents(
      "turn_retryable",
      retryableBrokenStream(),
      {
        now: () => 520,
      },
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.error",
      "stream.aborted",
    ]);
    expect(events[1]?.payload).toMatchObject({
      error: {
        code: "PROVIDER_TRANSIENT_FAILURE",
        retryable: true,
      },
    });
    expect(events[2]?.payload).toMatchObject({
      failure: {
        error: {
          retryable: true,
        },
      },
    });
  });

  it("preserves fatal provider failures in stream contracts", async () => {
    async function* fatalBrokenStream() {
      yield { type: "response_started", providerId: "fake" } as const;
      throw new ModelProviderError({
        providerId: "fake",
        stage: "stream",
        code: "HTTP_4XX",
        message: "unauthorized",
        statusCode: 401,
        retryable: false,
      });
    }

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_fatal", fatalBrokenStream(), {
      now: () => 530,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "stream.started",
      "stream.error",
      "stream.aborted",
    ]);
    expect(events[1]?.payload).toMatchObject({
      error: {
        code: "PROVIDER_FAILURE",
        message: "unauthorized",
        retryable: false,
      },
    });
    expect(events[2]?.payload).toMatchObject({
      failure: {
        error: {
          retryable: false,
        },
      },
    });
  });
});

describe("adaptStreamToContractEventEnvelopes", () => {
  it("tracks sequence, chunkIndex and terminal markers for persistence", async () => {
    const source = [
      { type: "response_started", providerId: "fake" } as const,
      { type: "text_delta", providerId: "fake", text: "a" } as const,
      { type: "status_delta", providerId: "fake", status: "planning" } as const,
      { type: "response_completed", providerId: "fake", finishReason: "stop" } as const,
    ];

    const envelopes = [];
    for await (const envelope of adaptStreamToContractEventEnvelopes("turn_6", source, {
      now: () => 600,
    })) {
      envelopes.push(envelope);
    }

    expect(envelopes.map((envelope) => envelope.sequence)).toEqual([0, 1, 2, 3]);
    expect(envelopes.map((envelope) => envelope.chunkIndex)).toEqual([0, 0, 1, 1]);
    expect(envelopes.map((envelope) => envelope.terminal)).toEqual([false, false, false, true]);
    expect(envelopes.map((envelope) => envelope.sourceType)).toEqual([
      "response_started",
      "text_delta",
      "status_delta",
      "response_completed",
    ]);
  });
});

describe("contract stream observation helpers", () => {
  it("derives latest turn/step without changing stream schema", async () => {
    const source = [
      { type: "response_started", providerId: "fake" } as const,
      { type: "status_delta", providerId: "fake", status: "planning" } as const,
      { type: "text_delta", providerId: "fake", text: "hello" } as const,
      { type: "response_completed", providerId: "fake", finishReason: "stop" } as const,
    ];

    const events = [];
    for await (const event of adaptStreamToContractEvents("turn_obs", source, {
      now: () => 700,
    })) {
      events.push(event);
    }

    const snapshot = summarizeContractStreamEvents(events);
    expect(snapshot).toMatchObject({
      latestTurnId: "turn_obs",
      latestStepId: "status_1",
      latestStepIndex: 1,
      lastEventKind: "stream.completed",
      terminal: true,
    });
  });

  it("supports incremental observation for status views", () => {
    const started = adaptStreamEventToContractEvent({
      turnId: "turn_incremental",
      source: { type: "response_started", providerId: "fake" },
      sequence: 0,
      chunkIndex: 0,
      occurredAtMs: 710,
      eventId: "evt_started",
    }).event;
    const step = adaptStreamEventToContractEvent({
      turnId: "turn_incremental",
      source: { type: "status_delta", providerId: "fake", status: "planning" },
      sequence: 1,
      chunkIndex: 0,
      occurredAtMs: 711,
      eventId: "evt_step",
    }).event;
    const resumed = adaptStreamEventToContractEvent({
      turnId: "turn_incremental",
      source: { type: "response_resumed", providerId: "fake" },
      sequence: 2,
      chunkIndex: 0,
      occurredAtMs: 712,
      eventId: "evt_resumed",
    }).event;

    const s1 = observeContractStreamEvent(undefined, started);
    const s2 = observeContractStreamEvent(s1, step);
    const s3 = observeContractStreamEvent(s2, resumed);

    expect(s1.latestTurnId).toBe("turn_incremental");
    expect(s1.latestStepId).toBeUndefined();
    expect(s2.latestStepId).toBe("status_1");
    expect(s2.latestStepIndex).toBe(1);
    expect(s2.terminal).toBe(false);
    expect(s3.latestStepId).toBe("status_1");
    expect(s3.lastEventKind).toBe("stream.resumed");
    expect(s3.terminal).toBe(false);
  });

  it("creates contract failure envelopes for non-stream provider failures", () => {
    const envelopes = createContractFailureEventEnvelopes({
      turnId: "turn_generate_fail",
      message: "upstream 429",
      retryable: true,
      sequenceStart: 10,
      occurredAtMs: 999,
      eventIdFactory(input) {
        return `evt_${input.sequence}_${input.sourceType}`;
      },
    });

    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]?.event.kind).toBe("stream.error");
    expect(envelopes[0]?.event.payload.error).toMatchObject({
      code: "PROVIDER_TRANSIENT_FAILURE",
      retryable: true,
    });
    expect(envelopes[1]?.event.kind).toBe("stream.aborted");
    expect(envelopes[1]?.event.payload.failure.error.retryable).toBe(true);
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual([10, 11]);
  });

  it("marks fatal non-stream provider failures as PROVIDER_FAILURE", () => {
    const envelopes = createContractFailureEventEnvelopes({
      turnId: "turn_generate_fatal",
      message: "unauthorized",
      retryable: false,
      sequenceStart: 20,
      occurredAtMs: 1_000,
    });

    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]?.event.kind).toBe("stream.error");
    expect(envelopes[0]?.event.payload.error).toMatchObject({
      code: "PROVIDER_FAILURE",
      message: "unauthorized",
      retryable: false,
    });
    expect(envelopes[1]?.event.kind).toBe("stream.aborted");
    expect(envelopes[1]?.event.payload.failure.error.retryable).toBe(false);
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual([20, 21]);
  });
});
