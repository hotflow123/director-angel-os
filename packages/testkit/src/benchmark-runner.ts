import { createHash } from "node:crypto";

import type { ScenarioRunner, ScenarioStep, TurnResult } from "./scenario-runner.js";

export interface BenchmarkCase {
  readonly id: string;
  readonly description?: string;
  createRunner(): ScenarioRunner;
  readonly steps: readonly ScenarioStep[];
  gate?(results: readonly TurnResult[]): Promise<void> | void;
}

export interface BenchmarkGateOptions {
  readonly suiteId: string;
  readonly cases: readonly BenchmarkCase[];
  readonly iterations?: number;
}

export interface BenchmarkRunRecord {
  readonly suiteId: string;
  readonly caseId: string;
  readonly description?: string;
  readonly iteration: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly replayDurationMs: number;
  readonly replayMatched: boolean;
  readonly fingerprint: string;
  readonly replayFingerprint: string;
  readonly error?: string;
}

export interface BenchmarkGateSummary {
  readonly suiteId: string;
  readonly timestamp: string;
  readonly iterations: number;
  readonly totalRuns: number;
  readonly failedRuns: number;
}

export interface BenchmarkGateReport {
  readonly summary: BenchmarkGateSummary;
  readonly runs: readonly BenchmarkRunRecord[];
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

function toDurationMs(startedAt: bigint): number {
  const elapsed = process.hrtime.bigint() - startedAt;
  return Number(elapsed) / 1_000_000;
}

export function createScenarioFingerprint(results: readonly TurnResult[]): string {
  const serialized = JSON.stringify(
    results.map((turn) => ({
      output: turn.response.output,
      fingerprint: turn.replayFingerprint,
    })),
  );
  return createHash("sha256").update(serialized).digest("hex");
}

async function executeBenchmarkCase(benchmarkCase: BenchmarkCase): Promise<{
  readonly durationMs: number;
  readonly fingerprint: string;
}> {
  const runner = benchmarkCase.createRunner();
  const startedAt = process.hrtime.bigint();
  const results = await runner.runScenario(benchmarkCase.steps);
  await benchmarkCase.gate?.(results);
  return {
    durationMs: toDurationMs(startedAt),
    fingerprint: createScenarioFingerprint(results),
  };
}

export async function runBenchmarkGate(
  options: BenchmarkGateOptions,
): Promise<BenchmarkGateReport> {
  const iterations = toPositiveInteger(options.iterations, 1);
  const runs: BenchmarkRunRecord[] = [];

  for (const benchmarkCase of options.cases) {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      let ok = true;
      let errorMessage: string | undefined;
      let durationMs = 0;
      let replayDurationMs = 0;
      let fingerprint = "";
      let replayFingerprint = "";
      let replayMatched = false;

      try {
        const executed = await executeBenchmarkCase(benchmarkCase);
        durationMs = Number(executed.durationMs.toFixed(2));
        fingerprint = executed.fingerprint;

        const replayed = await executeBenchmarkCase(benchmarkCase);
        replayDurationMs = Number(replayed.durationMs.toFixed(2));
        replayFingerprint = replayed.fingerprint;
        replayMatched = fingerprint === replayFingerprint;
        if (!replayMatched) {
          ok = false;
          errorMessage = "Replay fingerprint mismatch";
        }
      } catch (error) {
        ok = false;
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      const runRecordBase = {
        suiteId: options.suiteId,
        caseId: benchmarkCase.id,
        iteration,
        ok,
        durationMs,
        replayDurationMs,
        replayMatched,
        fingerprint,
        replayFingerprint,
        ...(benchmarkCase.description !== undefined
          ? { description: benchmarkCase.description }
          : {}),
      };

      runs.push(
        errorMessage === undefined
          ? runRecordBase
          : {
              ...runRecordBase,
              error: errorMessage,
            },
      );
    }
  }

  const failedRuns = runs.filter((run) => !run.ok).length;
  return {
    summary: {
      suiteId: options.suiteId,
      timestamp: new Date().toISOString(),
      iterations,
      totalRuns: runs.length,
      failedRuns,
    },
    runs,
  };
}
