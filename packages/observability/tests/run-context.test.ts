import { describe, expect, test } from "vitest";

import {
  createRunContext,
  getRunContext,
  runWithContext,
  setRunContextValue,
  withRunContextValue,
} from "../src/index.js";

describe("run-context helpers", () => {
  test("provides and restores context", () => {
    const context = createRunContext({
      runId: "run_1",
      traceId: "trace_1",
      values: { worker: "w2" },
    });

    expect(getRunContext()).toBeUndefined();

    runWithContext(context, () => {
      expect(getRunContext()?.runId).toBe("run_1");
      setRunContextValue("phase", "build");
      expect(getRunContext()?.values.phase).toBe("build");
    });

    expect(getRunContext()).toBeUndefined();
  });

  test("supports async call chains", async () => {
    await withRunContextValue("requestId", "req_1", async () => {
      await Promise.resolve();
      expect(getRunContext()?.values.requestId).toBe("req_1");
    });

    expect(getRunContext()).toBeUndefined();
  });

  test("isolates overlapping async contexts", async () => {
    const seen: string[] = [];

    await Promise.all([
      runWithContext({ runId: "run_a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push(getRunContext()?.runId ?? "missing_a");
      }),
      runWithContext({ runId: "run_b" }, async () => {
        await Promise.resolve();
        seen.push(getRunContext()?.runId ?? "missing_b");
      }),
    ]);

    expect(seen.sort()).toEqual(["run_a", "run_b"]);
    expect(getRunContext()).toBeUndefined();
  });
});
