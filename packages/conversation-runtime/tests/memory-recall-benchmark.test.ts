import { describe, expect, it } from "vitest";

import {
  createDirectorMemoryRecallBenchmarkFixture,
  evaluateConversationRuntimeMemoryRecallBenchmark,
} from "../src/index.js";

describe("conversation runtime memory recall benchmark", () => {
  it("runs planted-needle suite with six director-domain cases and reports recall, provenance, and latency", () => {
    const suite = createDirectorMemoryRecallBenchmarkFixture({
      retrievedByCaseId: {
        "script-tone-recall": [
          hit("script:opening-voiceover", 0.98, {
            evidenceRefIds: ["evidence:opening-script"],
            sourceRefs: ["script://episode-01"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
        "scene-blocking-recall": [
          hit("scene:rain-bridge-blocking", 0.94, {
            evidenceRefIds: ["evidence:rain-bridge-script"],
            sourceRefs: ["script://episode-01"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
        "shot-lens-recall": [
          hit("shot:rain-bridge-telephoto", 0.91, {
            evidenceRefIds: ["evidence:shot-list"],
            sourceRefs: ["shotlist://episode-01"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
        "asset-continuity-recall": [
          hit("asset:red-umbrella", 0.9, {
            evidenceRefIds: ["evidence:asset-board"],
            sourceRefs: ["asset://red-umbrella"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
        "decision-rationale-recall": [
          hit("decision:keep-rain-ambience", 0.89, {
            evidenceRefIds: ["evidence:director-note"],
            sourceRefs: ["decision://sound-design"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
        "evidence-source-recall": [
          hit("evidence:weixin-six-grid-design", 0.88, {
            evidenceRefIds: ["evidence:weixin-six-grid-design"],
            sourceRefs: ["https://example.test/weixin/six-grid"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
      },
      defaultLatencyMs: 12,
    });

    const report = evaluateConversationRuntimeMemoryRecallBenchmark(suite);

    expect(report).toMatchObject({
      schemaVersion: "conversation-runtime.memory-recall-benchmark.v1",
      suiteId: "director-memory-planted-needle.v1",
      caseCount: 6,
      passed: true,
      metrics: {
        recallAtK: 1,
        recallAnyAtK: 1,
        recallAllAtK: 1,
        ndcgAtK: 1,
        provenanceCompleteness: 1,
        averageLatencyMs: 12,
        p95LatencyMs: 12,
      },
      failures: [],
    });
    expect(report.results.map((result) => result.domain)).toEqual([
      "script",
      "scene",
      "shot",
      "asset",
      "decision",
      "evidence",
    ]);
  });

  it("flags missing provenance even if recall succeeds", () => {
    const suite = createDirectorMemoryRecallBenchmarkFixture({
      retrievedByCaseId: {
        "scene-blocking-recall": [
          hit("scene:rain-bridge-blocking", 0.94, {
            evidenceRefIds: ["evidence:rain-bridge-script"],
            sourceRefs: [],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
      },
      defaultLatencyMs: 7,
    });

    const report = evaluateConversationRuntimeMemoryRecallBenchmark(suite, {
      caseIds: ["scene-blocking-recall"],
    });

    expect(report.passed).toBe(false);
    expect(report.metrics).toMatchObject({
      recallAtK: 1,
      provenanceCompleteness: 0,
      averageLatencyMs: 7,
      p95LatencyMs: 7,
    });
    expect(report.failures).toEqual([
      expect.objectContaining({
        caseId: "scene-blocking-recall",
        type: "missing-provenance",
        missingProvenanceHitIds: ["scene:rain-bridge-blocking"],
      }),
    ]);
  });

  it("reports missing expected needle ids when top-k misses them", () => {
    const suite = createDirectorMemoryRecallBenchmarkFixture({
      retrievedByCaseId: {
        "asset-continuity-recall": [
          hit("asset:blue-coat", 0.87, {
            evidenceRefIds: ["evidence:wrong-asset"],
            sourceRefs: ["asset://blue-coat"],
            policyEnvelopeRefs: ["policy:memory-read"],
          }),
        ],
      },
      defaultLatencyMs: 20,
    });

    const report = evaluateConversationRuntimeMemoryRecallBenchmark(suite, {
      caseIds: ["asset-continuity-recall"],
    });

    expect(report.passed).toBe(false);
    expect(report.metrics).toMatchObject({
      recallAtK: 0,
      recallAnyAtK: 0,
      recallAllAtK: 0,
      ndcgAtK: 0,
      provenanceCompleteness: 1,
    });
    expect(report.failures).toEqual([
      expect.objectContaining({
        caseId: "asset-continuity-recall",
        type: "missing-expected-ids",
        missingExpectedIds: ["asset:red-umbrella"],
      }),
    ]);
  });
});

function hit(
  id: string,
  score: number,
  provenance: {
    readonly evidenceRefIds: readonly string[];
    readonly sourceRefs: readonly string[];
    readonly policyEnvelopeRefs: readonly string[];
  },
) {
  return {
    id,
    source: "knowledge",
    status: "hit",
    score,
    provenance,
  } as const;
}
