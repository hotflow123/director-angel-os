import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeEvolutionSignals,
  createSourceEvidenceRef,
  createToolResultEvidenceRecord,
  createUrlAccessLimitedMemoryEvidence,
} from "../src/index.js";

describe("conversation memory evidence", () => {
  it("records source evidence without losing the original source pointer", () => {
    const source = createSourceEvidenceRef({
      id: "source-1",
      sourceKind: "url",
      sourceRef: "https://mp.weixin.qq.com/s/example",
      sourceSnapshotId: "snapshot-1",
      sourceAccessStatus: "source_access_limited",
      sourceAccessError: "当前环境异常，完成验证后即可继续访问。",
      privacy: "pii_potential",
      observedAtMs: 100,
    });

    expect(source.sourceRef).toBe("https://mp.weixin.qq.com/s/example");
    expect(source.sourceAccessStatus).toBe("source_access_limited");
    expect(source.publishable).toBe(false);
  });

  it("marks access-limited URL learning as low-confidence and not publishable", () => {
    const evidence = createUrlAccessLimitedMemoryEvidence({
      id: "memory-1",
      sourceRef: "https://mp.weixin.qq.com/s/example",
      sourceSnapshotId: "snapshot-1",
      sourceAccessError: "环境异常",
      observedAtMs: 100,
    });

    expect(evidence.confidence).toBe("low");
    expect(evidence.publishable).toBe(false);
    expect(evidence.failureTaxonomy).toContain("url_access_limited");
    expect(evidence.sourceAccessStatus).toBe("source_access_limited");
    expect(evidence.userConfirmed).toBe(false);
  });

  it("projects tool results into deterministic, non-publishable evidence records", () => {
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-1",
      turnRunId: "run-1",
      sessionKey: "session-1",
      toolCallId: "tool-1",
      toolName: "web_extract",
      ok: true,
      content: "A".repeat(120),
      output: { url: "https://example.test/page" },
      metadata: {
        sourceUrl: "https://example.test/page",
        sourceSnapshotId: "snapshot-page-1",
        privacy: "public",
        agentBoundary: "parent",
      },
      observedAtMs: 100,
      previewMaxChars: 24,
    });

    expect(evidence).toMatchObject({
      id: "tool-evidence-run-1-tool-1",
      sourceKind: "tool-result",
      sourceRef: "tool://web_extract/tool-1",
      sourceSnapshotId: "snapshot-page-1",
      sourceAccessStatus: "available",
      confidence: "medium",
      publishable: false,
      privacy: "public",
      provenance: ["tool-result", "conversation-runtime"],
      evidenceRefs: ["snapshot-page-1"],
      failureTaxonomy: [],
      userConfirmed: false,
      metadata: expect.objectContaining({
        turnId: "turn-1",
        turnRunId: "run-1",
        sessionKey: "session-1",
        toolCallId: "tool-1",
        toolName: "web_extract",
        status: "success",
        truncated: true,
        declaredTransformations: ["tool_result_truncate"],
        preview: expect.stringContaining("[truncated"),
        outputKind: "object",
        sourceUrl: "https://example.test/page",
        agentBoundary: "parent",
      }),
    });

    const replay = createToolResultEvidenceRecord({
      turnId: "turn-1",
      turnRunId: "run-1",
      sessionKey: "session-1",
      toolCallId: "tool-1",
      toolName: "web_extract",
      ok: true,
      content: "different replay content",
      observedAtMs: 200,
    });
    expect(replay.id).toBe(evidence.id);
  });

  it("snapshots tool ledger disclosure and content refs for later candidate reads", () => {
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-ledger-snapshot",
      turnRunId: "run-ledger-snapshot",
      sessionKey: "desktop:workbench",
      toolCallId: "call-web",
      toolName: "web_extract",
      ok: true,
      content: "status: success\ntext_preview: 这段只给模型预览",
      output: {
        url: "https://example.test/source",
        source_snapshot: {
          id: "web-extract-https-example-test-source",
          source_ref: "https://example.test/source",
          access_status: "available",
        },
        external_content: {
          source_url: "https://example.test/source",
          final_url: "https://example.test/source",
          title: "Source",
          content_type: "text/plain",
          trust_boundary: "external-web",
        },
        evidence_disclosure: {
          url: "https://example.test/source",
          title: "Source",
          full_body_chars: 4096,
          read_status: "read",
          media_count: 0,
        },
      },
      metadata: {
        contentRef: {
          kind: "tool-ledger",
          evidenceId: "tool-evidence-run-ledger-snapshot-call-web",
          fullContentRef: "tool-evidence-content/tool-evidence-run-ledger-snapshot-call-web.txt",
        },
      },
    });

    expect(evidence.metadata).toMatchObject({
      sourceUrl: "https://example.test/source",
      sourceSnapshotId: "web-extract-https-example-test-source",
      evidenceDisclosureSnapshot: expect.objectContaining({
        url: "https://example.test/source",
        full_body_chars: 4096,
        read_status: "read",
      }),
      externalContentSnapshot: expect.objectContaining({
        final_url: "https://example.test/source",
        trust_boundary: "external-web",
      }),
      contentRef: expect.objectContaining({
        kind: "tool-ledger",
        evidenceId: "tool-evidence-run-ledger-snapshot-call-web",
      }),
    });
  });

  it("keeps failed and aborted tool evidence explicit without making it publishable", () => {
    const failed = createToolResultEvidenceRecord({
      turnId: "turn-2",
      sessionKey: "session-1",
      toolCallId: "tool-2",
      toolName: "mcp__exa__search",
      ok: false,
      content: "MCP server unavailable",
      error: "mcp-executor-unavailable",
      metadata: { status: "permission_denied" },
      observedAtMs: 100,
    });
    const aborted = createToolResultEvidenceRecord({
      turnId: "turn-3",
      sessionKey: "session-1",
      toolCallId: "tool-3",
      toolName: "browser_navigate",
      ok: false,
      content: "operator stopped",
      error: "AbortError",
      metadata: { aborted: true },
      observedAtMs: 100,
    });

    expect(failed.publishable).toBe(false);
    expect(failed.sourceAccessStatus).toBe("failed");
    expect(failed.failureTaxonomy).toEqual(["permission_denied", "mcp-executor-unavailable"]);
    expect(failed.metadata).toMatchObject({ status: "permission_denied" });

    expect(aborted.publishable).toBe(false);
    expect(aborted.sourceAccessStatus).toBe("failed");
    expect(aborted.failureTaxonomy).toEqual(["aborted", "AbortError"]);
    expect(aborted.metadata).toMatchObject({ status: "aborted" });
  });

  it("keeps low-quality web extraction evidence low-confidence and access-limited", () => {
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-low-quality",
      sessionKey: "session-1",
      toolCallId: "tool-web-extract-blocked",
      toolName: "web_extract",
      ok: false,
      content:
        "status: blocked\nsummary: Extracted content was blocked or too low-quality to treat as learned source content.",
      output: {
        status: "blocked",
        url: "https://mp.weixin.qq.com/s/example",
        quality: {
          status: "blocked",
          score: 0,
          reason: "low-quality extracted content",
          publishable: false,
        },
        source_snapshot: {
          id: "web-extract-https-mp-weixin-qq-com-s-example",
          source_ref: "https://mp.weixin.qq.com/s/example",
          access_status: "source_access_limited",
        },
      },
      error: "low-quality extracted content",
      metadata: {
        sourceUrl: "https://mp.weixin.qq.com/s/example",
      },
    });

    expect(evidence).toMatchObject({
      confidence: "low",
      publishable: false,
      sourceAccessStatus: "source_access_limited",
      failureTaxonomy: expect.arrayContaining(["blocked", "low_quality_source"]),
      metadata: expect.objectContaining({
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        qualityStatus: "blocked",
        qualityReason: "low-quality extracted content",
        qualityScore: 0,
        sourceSnapshotId: "web-extract-https-mp-weixin-qq-com-s-example",
      }),
    });
  });

  it("uses declared tool source metadata for external adapter evidence", () => {
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-opencli",
      turnRunId: "run-opencli",
      sessionKey: "desktop:main",
      toolCallId: "call-opencli-hn",
      toolName: "opencli.local",
      ok: true,
      content: "OpenCLI 执行完成：hackernews/top",
      metadata: {
        sourceKind: "opencli",
        sourceRef: "opencli:hackernews/top",
        sourceAccessStatus: "available",
        providerId: "opencli",
      },
    });

    expect(evidence).toMatchObject({
      id: "tool-evidence-run-opencli-call-opencli-hn",
      sourceKind: "opencli",
      sourceRef: "opencli:hackernews/top",
      sourceAccessStatus: "available",
      provenance: ["tool-result", "conversation-runtime"],
      publishable: false,
      metadata: expect.objectContaining({
        toolName: "opencli.local",
        providerId: "opencli",
      }),
    });
  });

  it("keeps policy envelope refs on tool evidence without replacing verbatim preview", () => {
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-policy",
      turnRunId: "run-policy",
      sessionKey: "desktop:main",
      toolCallId: "call-media",
      toolName: "media_analyzer",
      ok: false,
      content: "External tool media_analyzer blocked by policy: Tool execution requires approval",
      metadata: {
        policyEnvelopeRefs: ["policy-ref-tool-media-analyzer"],
        sourceRefs: ["https://cdn.example.test/frame.png"],
        evidenceRefIds: ["media-evidence-1"],
      },
      observedAtMs: 123,
    });

    expect(evidence).toMatchObject({
      id: "tool-evidence-run-policy-call-media",
      policyEnvelopeRefs: ["policy-ref-tool-media-analyzer"],
      evidenceRefs: ["media-evidence-1"],
      metadata: expect.objectContaining({
        policyEnvelopeRefs: ["policy-ref-tool-media-analyzer"],
        sourceRefs: ["https://cdn.example.test/frame.png"],
        evidenceRefIds: ["media-evidence-1"],
        preview: "External tool media_analyzer blocked by policy: Tool execution requires approval",
      }),
    });
  });

  it("projects runtime turns into auditable evolution signals without publishing them as memory", () => {
    const toolEvidence = createToolResultEvidenceRecord({
      turnId: "turn-1",
      turnRunId: "run-1",
      sessionKey: "weixin:user-1",
      toolCallId: "tool-search-1",
      toolName: "web_search",
      ok: true,
      content: "找到 Seedance 2.0 公众号教程候选。",
      observedAtMs: 100,
    });

    const signals = createConversationRuntimeEvolutionSignals({
      turnId: "turn-1",
      sessionKey: "weixin:user-1",
      result: {
        turnId: "turn-1",
        turnRunId: "run-1",
        sessionKey: "weixin:user-1",
        surface: "weixin",
        channel: "weixin",
        messageId: "message-1",
        intentKind: "learning-admit",
        responsePolicy: "review-gated",
        memoryAction: "candidate-review",
        finalText: "这篇主要讲 Seedance 2.0 的分镜和运镜方法。",
        angelRoleProfile: {
          roleId: "director-angel",
          domain: "影视制作",
          responsibilities: ["持续学习影视制作经验"],
          learningScope: ["短剧制作"],
          controllableSystems: ["moyin"],
        },
        toolEvidenceRecords: [toolEvidence],
        traceRefs: ["capability.resolved", "model.loop.completed"],
        observedAtMs: 100,
      },
    });

    expect(signals).toEqual([
      expect.objectContaining({
        id: "evolution-turn-turn-1",
        kind: "turn",
        publishable: false,
        observedAtMs: 100,
        metadata: expect.objectContaining({
          sessionKey: "weixin:user-1",
          channel: "weixin",
          surface: "weixin",
          intentKind: "learning-admit",
          responsePolicy: "review-gated",
          memoryAction: "candidate-review",
          roleId: "director-angel",
          domain: "影视制作",
          controllableSystems: ["moyin"],
          userVisibleSummary: "这篇主要讲 Seedance 2.0 的分镜和运镜方法。",
          traceRefs: ["capability.resolved", "model.loop.completed"],
        }),
      }),
      expect.objectContaining({
        id: "evolution-tool-tool-evidence-run-1-tool-search-1",
        kind: "tool-result",
        publishable: false,
        metadata: expect.objectContaining({
          evidenceId: "tool-evidence-run-1-tool-search-1",
          sourceAccessStatus: "available",
          confidence: "medium",
          toolName: "web_search",
          roleId: "director-angel",
        }),
      }),
    ]);
  });
});
