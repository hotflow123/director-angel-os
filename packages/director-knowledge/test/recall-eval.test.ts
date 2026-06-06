import { describe, expect, it } from "vitest";

import {
  evaluateDirectorRecallPacket,
  evaluateDirectorRecallTrace,
  evaluateDirectorRecallTraceSuite,
  extractDirectorRecallEvalHits,
} from "../src/recall-eval.js";

describe("Director recall trace evaluation", () => {
  it("computes recall@k and ndcg@k for auditable memory/knowledge/skill traces", () => {
    const result = evaluateDirectorRecallTrace({
      queryId: "seedance-latest",
      expectedIds: ["knowledge:seedance", "memory:twitter-thread"],
      hits: [
        {
          id: "memory:twitter-thread",
          source: "memory",
          status: "hit",
          score: 0.93,
        },
        {
          id: "skill:web-search",
          source: "skill",
          status: "hit",
          score: 0.72,
        },
        {
          id: "knowledge:seedance",
          source: "knowledge",
          status: "hit",
          score: 0.81,
        },
      ],
      k: 2,
    });

    expect(result).toMatchObject({
      queryId: "seedance-latest",
      k: 2,
      expectedCount: 2,
      hitCount: 3,
      foundCount: 1,
      recallAtK: 0.5,
      recallAnyAtK: 1,
      recallAllAtK: 0,
    });
    expect(result.ndcgAtK).toBeCloseTo(0.613147, 5);
    expect(result.missingExpectedIds).toEqual(["knowledge:seedance"]);
    expect(result.retrievedIdsAtK).toEqual(["memory:twitter-thread", "skill:web-search"]);
  });

  it("aggregates a suite so regressions can fail one compact gate", () => {
    const suite = evaluateDirectorRecallTraceSuite([
      {
        queryId: "perfect",
        expectedIds: ["a"],
        hits: [{ id: "a", source: "knowledge", status: "hit" }],
        k: 3,
      },
      {
        queryId: "miss",
        expectedIds: ["b"],
        hits: [{ id: "c", source: "memory", status: "hit" }],
        k: 3,
      },
    ]);

    expect(suite).toMatchObject({
      caseCount: 2,
      averages: {
        recallAtK: 0.5,
        recallAnyAtK: 0.5,
        recallAllAtK: 0.5,
      },
    });
    expect(suite.averages.ndcgAtK).toBeCloseTo(0.5, 5);
    expect(suite.failures).toEqual([
      {
        queryId: "miss",
        missingExpectedIds: ["b"],
      },
    ]);
  });

  it("evaluates contextual recall packets with MemPalace working-memory hits", () => {
    const packet = {
      recallTrace: [
        {
          id: "memory:working-memory:mempalace:scene-style",
          source: "memory",
          status: "hit",
          score: 0.91,
        },
        {
          id: "knowledge:seedance-workflow",
          source: "knowledge",
          status: "hit",
          score: 0.85,
        },
        {
          id: "memory:degraded",
          source: "memory",
          status: "degraded",
        },
      ],
      skillHits: [{ id: "comfyui-workflow" }],
    };

    expect(extractDirectorRecallEvalHits(packet)).toEqual([
      expect.objectContaining({
        id: "memory:working-memory:mempalace:scene-style",
        source: "memory",
        status: "hit",
      }),
      expect.objectContaining({
        id: "knowledge:seedance-workflow",
        source: "knowledge",
        status: "hit",
      }),
      expect.objectContaining({
        id: "memory:degraded",
        source: "memory",
        status: "degraded",
      }),
      expect.objectContaining({
        id: "skill:comfyui-workflow",
        source: "skill",
        status: "hit",
      }),
    ]);

    const result = evaluateDirectorRecallPacket({
      queryId: "mempalace-cat-style",
      expectedIds: ["memory:working-memory:mempalace:scene-style", "skill:comfyui-workflow"],
      packet,
      k: 3,
    });

    expect(result).toMatchObject({
      queryId: "mempalace-cat-style",
      expectedCount: 2,
      foundCount: 2,
      recallAtK: 1,
      recallAnyAtK: 1,
      recallAllAtK: 1,
    });
    expect(result.retrievedIdsAtK).toEqual([
      "memory:working-memory:mempalace:scene-style",
      "knowledge:seedance-workflow",
      "skill:comfyui-workflow",
    ]);
  });
});
