import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeMemoryRetrievalRequest,
  createConversationRuntimeMemoryRetrievalProviderRegistry,
  createDirectorMemoryRecallBenchmarkFixture,
  evaluateConversationRuntimeMemoryRecallBenchmark,
  mapMemoryRetrievalResultToBenchmarkHits,
  planConversationRuntimeMempalaceLayerRetrieval,
} from "../src/index.js";

describe("conversation runtime memory retrieval providers", () => {
  it("fans out recall through provider manifests and emits benchmark-ready provenance", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    const bm25 = registry.register({
      manifest: {
        id: "local-bm25",
        kind: "bm25",
        label: "Local BM25",
        capabilities: ["lexical-recall"],
      },
      recall: async () => ({
        status: "hit",
        latencyMs: 8,
        hits: [
          {
            id: "scene:rain-bridge-blocking",
            source: "knowledge",
            title: "雨夜天桥调度",
            content: "雨夜天桥这场戏要用纵深调度压住人物距离。",
            score: 0.77,
            provenance: provenance("evidence:rain-bridge-script", "script://episode-01"),
          },
        ],
      }),
    });
    const vector = registry.register({
      manifest: {
        id: "semantic-vector",
        kind: "vector",
        label: "Semantic Vector",
        capabilities: ["semantic-recall"],
      },
      recall: async () => ({
        status: "hit",
        latencyMs: 12,
        hits: [
          {
            id: "shot:rain-bridge-telephoto",
            source: "knowledge",
            title: "雨夜长焦",
            summary: "用长焦压缩空间。",
            score: 0.91,
            provenance: provenance("evidence:shot-list", "shotlist://episode-01"),
          },
          {
            id: "scene:rain-bridge-blocking",
            source: "knowledge",
            title: "重复命中",
            summary: "低分重复命中应被去重。",
            score: 0.66,
            provenance: provenance("evidence:rain-bridge-vector", "script://episode-01"),
          },
        ],
      }),
    });

    expect(bm25).toMatchObject({ registered: true, plan: { status: "admissible" } });
    expect(vector).toMatchObject({ registered: true, plan: { status: "admissible" } });

    const result = await registry.recall({
      query: "雨夜天桥的调度和镜头语言",
      domains: ["scene", "shot"],
      maxHits: 2,
      maxChars: 16,
      policyEnvelopeRefs: ["policy:memory-read"],
      scope: { projectId: "episode-01" },
    });

    expect(result).toMatchObject({
      schemaVersion: "conversation-runtime.memory-retrieval-result.v1",
      status: "hit",
      query: "雨夜天桥的调度和镜头语言",
      providerTraces: [
        expect.objectContaining({ providerId: "local-bm25", status: "hit", hitCount: 1 }),
        expect.objectContaining({ providerId: "semantic-vector", status: "hit", hitCount: 2 }),
      ],
    });
    expect(result.hits.map((hit) => hit.id)).toEqual([
      "shot:rain-bridge-telephoto",
      "scene:rain-bridge-blocking",
    ]);
    expect(result.hits[1]).toMatchObject({
      summary: "雨夜天桥这场戏要用纵深调度压住人...",
      metadata: expect.objectContaining({
        providerId: "local-bm25",
        providerKind: "bm25",
        directStoreAccessAllowed: false,
        provenance: provenance("evidence:rain-bridge-script", "script://episode-01"),
      }),
    });

    const suite = createDirectorMemoryRecallBenchmarkFixture({
      retrievedByCaseId: {
        "scene-blocking-recall": mapMemoryRetrievalResultToBenchmarkHits(result),
      },
      k: 2,
    });
    const report = evaluateConversationRuntimeMemoryRecallBenchmark(suite, {
      caseIds: ["scene-blocking-recall"],
    });

    expect(report).toMatchObject({
      passed: true,
      metrics: {
        recallAnyAtK: 1,
        recallAllAtK: 1,
        provenanceCompleteness: 1,
      },
    });
  });

  it("blocks retrieval providers that ask for internal store access", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    let invoked = false;
    const registration = registry.register({
      manifest: {
        id: "unsafe-memory",
        kind: "vector",
        directStoreAccess: true,
        internalStores: ["src/stores/director-store.ts"],
        storeImports: ["src/stores/director-store.ts"],
      },
      recall: async () => {
        invoked = true;
        return { status: "hit", hits: [] };
      },
    });

    expect(registration).toMatchObject({
      registered: false,
      plan: {
        status: "blocked",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "direct-store-access-forbidden" }),
          expect.objectContaining({ code: "internal-store-import-forbidden" }),
        ]),
      },
    });

    const result = await registry.recall({ query: "任何查询" });

    expect(invoked).toBe(false);
    expect(result).toMatchObject({
      status: "miss",
      hits: [],
      providerTraces: [],
    });
  });

  it("keeps healthy provider hits when another provider degrades", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    registry.register({
      manifest: { id: "kg", kind: "knowledge-graph", label: "KG" },
      recall: async () => {
        throw new Error("KG offline");
      },
    });
    registry.register({
      manifest: { id: "mempalace", kind: "mempalace", label: "MemPalace" },
      recall: async () => ({
        status: "hit",
        latencyMs: 5,
        hits: [
          {
            id: "asset:red-umbrella",
            source: "memory",
            summary: "红伞必须贯穿雨夜段落。",
            score: 0.82,
            provenance: provenance("evidence:asset-board", "asset://red-umbrella"),
          },
        ],
      }),
    });

    const result = await registry.recall({
      query: "红伞连续性",
      maxHits: 3,
    });

    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "kg: KG offline",
      hits: [expect.objectContaining({ id: "asset:red-umbrella", status: "hit" })],
      providerTraces: expect.arrayContaining([
        expect.objectContaining({ providerId: "kg", status: "failed", summary: "KG offline" }),
        expect.objectContaining({ providerId: "mempalace", status: "hit", hitCount: 1 }),
      ]),
    });
    expect(mapMemoryRetrievalResultToBenchmarkHits(result)).toEqual([
      expect.objectContaining({
        id: "asset:red-umbrella",
        status: "hit",
        provenance: provenance("evidence:asset-board", "asset://red-umbrella"),
      }),
    ]);
  });

  it("preserves MemPalace verbatim excerpts and source pointers before summaries", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    registry.register({
      manifest: { id: "mempalace", kind: "mempalace", label: "MemPalace" },
      recall: async () => ({
        status: "hit",
        latencyMs: 6,
        hits: [
          {
            id: "mempalace:drawer-cat-style",
            source: "memory",
            summary: "摘要：小猫旅行风格。",
            content: "压缩内容：温暖治愈。",
            score: 0.94,
            provenance: provenance("evidence:cat-style", "mempalace://story/cat.md#drawer=4"),
            metadata: {
              wing: "story",
              room: "cat-travel",
              sourceFile: "cat.md",
              drawerIndex: 4,
              totalDrawers: 12,
              verbatim:
                "原文：用户上次确认小猫旅行记要使用温暖治愈风格。\n镜头要按场景拆，不能只给一句抽象总结。",
            },
          },
        ],
      }),
    });

    const result = await registry.recall({
      query: "小猫旅行记",
      maxHits: 1,
      maxChars: 28,
      sourceRefs: ["session://desktop/current"],
    });

    expect(result.hits[0]).toMatchObject({
      id: "mempalace:drawer-cat-style",
      metadata: expect.objectContaining({
        retrievalMode: "verbatim-first",
        verbatimSource: expect.objectContaining({
          sourceFile: "cat.md",
          wing: "story",
          room: "cat-travel",
          drawerIndex: 4,
          totalDrawers: 12,
          sourceRefs: ["mempalace://story/cat.md#drawer=4", "session://desktop/current"],
        }),
      }),
    });
    expect(result.hits[0]?.summary).toContain("原文：用户上次确认小猫旅行记");
    expect(result.hits[0]?.summary).toContain("镜头要");
    expect(result.hits[0]?.summary).not.toContain("摘要");
    expect(result.hits[0]?.metadata?.verbatimExcerpt).toContain("原文：用户上次确认小猫旅行记");
    expect(result.hits[0]?.metadata?.verbatimExcerpt).not.toContain("\n");
  });

  it("plans MemPalace L0-L3 retrieval with layer-specific budgets and fail-closed L3", () => {
    const wakeUpPlan = planConversationRuntimeMempalaceLayerRetrieval({ query: "启动上下文" });
    expect(wakeUpPlan).toMatchObject({
      allowedLayers: ["L0", "L1"],
      mode: "wake_up",
      maxHits: 4,
      maxChars: 900,
    });
    expect(wakeUpPlan.degraded).toBeUndefined();

    expect(
      planConversationRuntimeMempalaceLayerRetrieval({
        query: "seedance 镜头调度",
        requestedLayers: ["L2"],
        wing: "hotflow",
        room: "seedance",
      }),
    ).toMatchObject({
      allowedLayers: ["L2"],
      mode: "on_demand",
      maxHits: 10,
      maxChars: 500,
      scope: {
        wing: "hotflow",
        room: "seedance",
      },
    });

    expect(
      planConversationRuntimeMempalaceLayerRetrieval({
        query: "深搜所有旧记忆",
        requestedLayers: ["L3"],
        deepSearchAuthorized: false,
      }),
    ).toMatchObject({
      allowedLayers: [],
      mode: "blocked",
      maxHits: 0,
      degraded: {
        reason: "mempalace-l3-deep-search-authorization-required",
      },
    });

    expect(
      planConversationRuntimeMempalaceLayerRetrieval({
        query: "深搜所有旧记忆",
        requestedLayers: ["L3"],
        deepSearchAuthorized: true,
      }),
    ).toMatchObject({
      allowedLayers: ["L3"],
      mode: "deep_search",
      maxHits: 5,
      maxChars: 1200,
    });
  });

  it("applies MemPalace L2 layer policy to the actual provider recall request", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    const seenRequests: ConversationRuntimeMemoryRetrievalRequest[] = [];
    registry.register({
      manifest: { id: "mempalace", kind: "mempalace", label: "MemPalace" },
      recall: async (request) => {
        seenRequests.push(request);
        return {
          status: "hit",
          hits: [
            {
              id: "mempalace:seedance-shot-rhythm",
              source: "memory",
              summary: "Seedance 镜头节奏要按 wing/room 精确召回。",
              metadata: { memoryLayer: "L2", layerLabel: "L2 On-Demand" },
            },
          ],
        };
      },
    });

    const result = await registry.recall({
      query: "seedance 镜头节奏",
      maxHits: 99,
      maxChars: 2000,
      scope: { projectId: "hotflow" },
      metadata: {
        requestedLayers: ["L2"],
        wing: "hotflow",
        room: "seedance",
      },
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]).toMatchObject({
      maxHits: 10,
      maxChars: 500,
      scope: {
        projectId: "hotflow",
        wing: "hotflow",
        room: "seedance",
      },
      metadata: {
        requestedLayers: ["L2"],
        wing: "hotflow",
        room: "seedance",
        mempalaceLayerPlan: expect.objectContaining({
          mode: "on_demand",
          allowedLayers: ["L2"],
        }),
      },
    });
    expect(result.hits[0]?.metadata).toMatchObject({
      scope: {
        projectId: "hotflow",
        wing: "hotflow",
        room: "seedance",
      },
      mempalaceLayerPlan: expect.objectContaining({
        mode: "on_demand",
        allowedLayers: ["L2"],
      }),
    });
  });

  it("blocks MemPalace L3 provider recall unless deep search is explicitly authorized", async () => {
    const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
    let invoked = false;
    registry.register({
      manifest: { id: "mempalace", kind: "mempalace", label: "MemPalace" },
      recall: async () => {
        invoked = true;
        return { status: "hit", hits: [] };
      },
    });

    const result = await registry.recall({
      query: "深搜所有旧记忆",
      metadata: {
        requestedLayers: ["L3"],
        deepSearchAuthorized: false,
      },
    });

    expect(invoked).toBe(false);
    expect(result).toMatchObject({
      status: "degraded",
      hits: [],
      degradedReason: "mempalace: mempalace-l3-deep-search-authorization-required",
      providerTraces: [
        expect.objectContaining({
          providerId: "mempalace",
          status: "blocked",
          hitCount: 0,
          summary: "mempalace-l3-deep-search-authorization-required",
          metadata: expect.objectContaining({
            mempalaceLayerPlan: expect.objectContaining({
              mode: "blocked",
              allowedLayers: [],
            }),
          }),
        }),
      ],
    });
  });
});

function provenance(evidenceRefId: string, sourceRef: string) {
  return {
    evidenceRefIds: [evidenceRefId],
    sourceRefs: [sourceRef],
    policyEnvelopeRefs: ["policy:memory-read"],
  } as const;
}
