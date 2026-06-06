import { describe, expect, it } from "vitest";

import {
  mapSessionSearchResultToRuntimeMemoryResult,
  mapWorkingMemoryRecallBlockToRuntimeMemoryResult,
} from "../src/index.js";

describe("conversation runtime memory adapters", () => {
  it("maps session archive hits into session-search memory signals", () => {
    const result = mapSessionSearchResultToRuntimeMemoryResult(
      {
        query: {
          query: "按上次那个风格继续",
          limit: 5,
        },
        totalHits: 1,
        hits: [
          {
            source: "journal-payload",
            score: 42,
            matchedText: "上一次制作采用水墨风格，主角是一只小猫。",
            matchedTerms: ["水墨", "风格"],
            session: {
              sessionId: "session-storyboard",
              metadata: {
                title: "小猫旅行短片",
              },
              status: "active",
              schemaVersion: "sessions/v1",
              createdAtMs: 1_000,
              updatedAtMs: 1_000,
              archivedAtMs: null,
              archiveReason: null,
            },
            entry: {
              rowId: 7,
              sessionId: "session-storyboard",
              seq: 3,
              eventType: "assistant.output",
              turnId: "turn-style",
              payload: {
                summary: "上一次制作采用水墨风格，主角是一只小猫。",
              },
              schemaVersion: "sessions/v1",
              createdAtMs: 1_000,
            },
          },
        ],
      },
      {
        query: "按上次那个风格继续",
        maxHits: 5,
      },
    );

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: "session-search:session-storyboard:3",
      source: "session-search",
      status: "hit",
      title: "小猫旅行短片",
      summary: "上一次制作采用水墨风格，主角是一只小猫。",
      score: 42,
      metadata: {
        sessionId: "session-storyboard",
        eventType: "assistant.output",
        turnId: "turn-style",
        matchedTerms: ["水墨", "风格"],
      },
    });
  });

  it("returns a miss signal when session archive search has no hits", () => {
    const result = mapSessionSearchResultToRuntimeMemoryResult(
      {
        query: {
          query: "不存在的主题",
        },
        totalHits: 0,
        hits: [],
      },
      {
        query: "不存在的主题",
      },
    );

    expect(result.hits).toEqual([
      {
        id: "session-search:miss",
        source: "session-search",
        status: "miss",
        summary: "No prior session context matched the query.",
        metadata: {
          totalHits: 0,
        },
      },
    ]);
  });

  it("maps working-memory recall items into bounded runtime memory signals", () => {
    const result = mapWorkingMemoryRecallBlockToRuntimeMemoryResult(
      {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: {
          agentId: "angel",
          sessionId: "weixin:alice",
          namespace: "director-angel",
        },
        query: "小猫旅行记",
        items: [
          {
            id: "mempalace:scene-style",
            layer: "layer1",
            content: "用户上次确认小猫旅行记要使用温暖治愈风格。",
            score: 0.92,
            updatedAt: 1_777_000,
            metadata: {
              source: "mempalace",
              retrievalEngine: "mempalace",
              matchMode: "drawer+closet",
              vectorSimilarity: 0.92,
              bm25Score: 0.71,
              distance: 0.18,
              effectiveDistance: 0.07,
              closetBoost: 0.11,
              wing: "story",
              room: "cat-travel",
              sourceFile: "cat.md",
              memoryLayer: "L2",
              layerLabel: "L2 On-Demand",
              verbatim: "用户上次确认小猫旅行记要使用温暖治愈风格。\n镜头要按场景拆。",
              provenance: {
                engine: "mempalace",
                sourceFile: "cat.md",
                wing: "story",
                room: "cat-travel",
                drawerIndex: 4,
                totalDrawers: 12,
                memoryLayer: "L2",
              },
            },
          },
          {
            id: "local-preference",
            layer: "layer0",
            content: "用户偏好中文、结果优先。",
            score: 0.77,
            updatedAt: 1_776_000,
          },
        ],
      },
      {
        query: "小猫旅行记",
        maxHits: 1,
        maxChars: 18,
      },
    );

    expect(result.hits).toEqual([
      {
        id: "working-memory:mempalace:scene-style",
        source: "mempalace",
        status: "hit",
        title: "mempalace:scene-style",
        summary: "用户上次确认小猫旅行记要使用温暖治愈...",
        score: 0.92,
        metadata: {
          blockId: "working-memory-recall",
          layer: "layer1",
          source: "mempalace",
          retrievalEngine: "mempalace",
          matchMode: "drawer+closet",
          vectorSimilarity: 0.92,
          bm25Score: 0.71,
          distance: 0.18,
          effectiveDistance: 0.07,
          closetBoost: 0.11,
          wing: "story",
          room: "cat-travel",
          sourceFile: "cat.md",
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
          retrievalMode: "verbatim-first",
          verbatim: "用户上次确认小猫旅行记要使用温暖治愈风格。\n镜头要按场景拆。",
          verbatimExcerpt: "用户上次确认小猫旅行记要使用温暖治愈...",
          provenance: {
            engine: "mempalace",
            sourceFile: "cat.md",
            wing: "story",
            room: "cat-travel",
            drawerIndex: 4,
            totalDrawers: 12,
            memoryLayer: "L2",
          },
          updatedAt: 1_777_000,
          query: "小猫旅行记",
          scope: {
            agentId: "angel",
            sessionId: "weixin:alice",
            namespace: "director-angel",
          },
        },
      },
    ]);
  });

  it("uses working-memory verbatim text as the bounded summary when available", () => {
    const result = mapWorkingMemoryRecallBlockToRuntimeMemoryResult(
      {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: { sessionId: "desktop:main" },
        query: "小猫旅行记",
        items: [
          {
            id: "mempalace:scene-style",
            layer: "layer1",
            content: "摘要：温暖治愈。",
            score: 0.91,
            updatedAt: 1_777_000,
            metadata: {
              source: "mempalace",
              sourceFile: "cat.md",
              memoryLayer: "L2",
              layerLabel: "L2 On-Demand",
              wing: "story",
              room: "cat-travel",
              verbatim:
                "原文：用户上次确认小猫旅行记要使用温暖治愈风格。\n镜头要按场景拆，不能只留摘要。",
            },
          },
        ],
      },
      {
        query: "小猫旅行记",
        maxHits: 1,
        maxChars: 24,
      },
    );

    expect(result.hits[0]).toMatchObject({
      metadata: expect.objectContaining({
        retrievalMode: "verbatim-first",
        memoryLayer: "L2",
        layerLabel: "L2 On-Demand",
      }),
    });
    expect(result.hits[0]?.summary).toContain("原文：用户上次确认小猫旅行记");
    expect(result.hits[0]?.summary).not.toContain("摘要");
    expect(result.hits[0]?.metadata?.verbatimExcerpt).toContain("原文：用户上次确认小猫旅行记");
    expect(result.hits[0]?.metadata?.verbatimExcerpt).not.toContain("\n");
  });

  it("surfaces working-memory degradation without promoting it into experience", () => {
    const result = mapWorkingMemoryRecallBlockToRuntimeMemoryResult(
      {
        blockId: "working-memory-recall",
        source: "working-memory",
        scope: { sessionId: "desktop:workbench" },
        items: [],
        degraded: {
          reason: "mempalace-timeout",
          message: "MemPalace search timed out",
        },
      },
      {
        query: "记忆状态",
      },
    );

    expect(result.degradedReason).toBe("mempalace-timeout: MemPalace search timed out");
    expect(result.hits).toEqual([
      {
        id: "working-memory:degraded:working-memory-recall",
        source: "working-memory",
        status: "degraded",
        summary: "MemPalace search timed out",
        metadata: {
          blockId: "working-memory-recall",
          reason: "mempalace-timeout",
          scope: { sessionId: "desktop:workbench" },
        },
      },
    ]);
  });
});
