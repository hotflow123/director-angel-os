import { describe, expect, test } from "vitest";

import {
  type BenchmarkCase,
  FakeMemory,
  FakeModel,
  FakeSession,
  ScenarioRunner,
  createWave1QualityBenchmarkCases,
  createWave2RecoveryBenchmarkCases,
  runBenchmarkGate,
} from "../src/index.js";

describe("runBenchmarkGate", () => {
  test("passes Wave 1 fixed regression cases", async () => {
    const report = await runBenchmarkGate({
      suiteId: "wave1-quality-test",
      cases: createWave1QualityBenchmarkCases(),
    });

    expect(report.summary.totalRuns).toBe(4);
    expect(report.summary.failedRuns).toBe(0);
    expect(report.runs.every((run) => run.replayMatched)).toBe(true);
  });

  test("passes Wave 2 recovery regression cases", async () => {
    const report = await runBenchmarkGate({
      suiteId: "wave2-recovery-test",
      cases: createWave2RecoveryBenchmarkCases(),
    });

    expect(report.summary.totalRuns).toBe(1);
    expect(report.summary.failedRuns).toBe(0);
    expect(report.runs.every((run) => run.replayMatched)).toBe(true);
  });

  test("fails when replay fingerprint is unstable", async () => {
    let sequence = 0;
    const unstableCase: BenchmarkCase = {
      id: "unstable-output",
      createRunner() {
        sequence += 1;
        const model = new FakeModel({
          responders: [
            () => ({
              output: `nondeterministic-${sequence}`,
            }),
          ],
        });
        return new ScenarioRunner({
          model,
          memory: new FakeMemory(),
          session: new FakeSession({ id: "unstable" }),
        });
      },
      steps: [{ input: "hello" }],
    };

    const report = await runBenchmarkGate({
      suiteId: "unstable-check",
      cases: [unstableCase],
    });

    expect(report.summary.failedRuns).toBe(1);
    expect(report.runs[0]).toMatchObject({
      ok: false,
      replayMatched: false,
      error: "Replay fingerprint mismatch",
    });
  });
});
