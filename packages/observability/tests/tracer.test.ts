import { describe, expect, test } from "vitest";

import { createTracer, runWithContext } from "../src/index.js";

describe("createTracer", () => {
  test("captures spans and context parent linkage", () => {
    let now = 100;
    const tracer = createTracer({
      now: () => {
        now += 10;
        return now;
      },
    });

    runWithContext({ traceId: "trace_parent", spanId: "span_parent" }, () => {
      const span = tracer.startSpan("turn.run", { mode: "test" });
      span.addEvent("started");
      span.end("ok");
    });

    const finished = tracer.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      name: "turn.run",
      traceId: "trace_parent",
      parentSpanId: "span_parent",
      status: "ok",
      attributes: { mode: "test" },
    });
    expect(finished[0]?.durationMs).toBeGreaterThan(0);
  });
});
