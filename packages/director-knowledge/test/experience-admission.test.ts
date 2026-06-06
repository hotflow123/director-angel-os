import { describe, expect, it } from "vitest";

import { HeuristicExperienceAdmissionAdapter } from "../src/experience-admission.js";

describe("HeuristicExperienceAdmissionAdapter", () => {
  it("admits readable web sources while preserving raw source evidence", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "web-text",
      sourceId: "public_guide",
      sourceKind: "web-page",
      sourceRef: "https://example.com/director-guide",
      title: "Director guide",
      contentType: "text/html",
      rawContent: [
        "<html><head><title>Director guide</title><script>ignore()</script></head>",
        "<body><p>Preserve evidence, compare references, and keep learning review-gated before publishing reusable operating guidance.</p></body></html>",
      ].join(""),
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 1_000,
      quarantineNotes: ["Direct URL learning requires readable source content."],
    });

    expect(admission.declaredTransformations).toEqual(
      expect.arrayContaining([
        "html_readability_extract",
        "whitespace_normalize",
        "quality_gate",
        "quarantine_low_quality",
      ]),
    );
    expect(decision.status).toBe("accepted");
    expect(decision.artifact.digest).toMatch(/^sha256:/);
    expect(decision.artifact.rawContent).toContain("<script>");
    expect((decision.artifact as unknown as Record<string, unknown>).readableContent).toContain(
      "review-gated",
    );
    expect(
      (decision.artifact as unknown as Record<string, unknown>).extractionReport,
    ).toMatchObject({
      status: "ok",
      readableChars: expect.any(Number),
      transformations: expect.arrayContaining(["html_readability_extract"]),
    });
    expect(decision.artifact.textPreview).toContain("Preserve evidence");
    expect(decision.artifact.textPreview).not.toContain("<script>");
    expect(decision.readableContent).toContain("review-gated");
  });

  it("preserves structured browser capture sections so desktop review can render text, tables, and media in order", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "web-text",
      sourceId: "browser_rich_guide",
      sourceKind: "web-page",
      sourceRef: "https://example.com/rich-guide",
      title: "AI短剧基础知识",
      contentType: "text/plain; charset=utf-8",
      rawContent: [
        "AI短剧基础知识",
        "https://example.com/rich-guide",
        "",
        "## 页面内容",
        "",
        "### 一、景别",
        "",
        "学习镜头语言时，先保留原文顺序、表格和图片证据，再提炼经验。",
        "",
        "![景别示例](https://cdn.example.com/shot-size.png) 640x360",
        "",
        "### 表格 1：垂直拍摄角度",
        "| 角度 | 作用 | 适合场景 |",
        "| --- | --- | --- |",
        "| 仰视 | 增强力量感 | 英雄登场 |",
        "| 俯视 | 展示弱小或空间 | 城市人群 |",
        "",
        "## 抓取记录",
        "- 页面滚动高度：2400",
        "- 自动滚动步数：4",
      ].join("\n"),
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
        blocks: [
          { kind: "heading", level: 1, text: "一、景别" },
          { kind: "text", text: "学习镜头语言时，先保留原文顺序、表格和图片证据。" },
          {
            kind: "media",
            media: {
              kind: "image",
              src: "https://cdn.example.com/shot-size.png",
              alt: "景别示例",
            },
          },
        ],
        tables: [
          {
            caption: "垂直拍摄角度",
            rows: [
              ["角度", "作用", "适合场景"],
              ["仰视", "增强力量感", "英雄登场"],
            ],
          },
        ],
        media: [
          {
            kind: "image",
            src: "https://cdn.example.com/shot-size.png",
            alt: "景别示例",
          },
        ],
      },
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 4_000,
      quarantineNotes: ["Direct URL learning requires readable source content."],
    });

    expect(decision.status).toBe("accepted");
    expect(decision.readableContent).toContain("\n## 页面内容\n");
    expect(decision.readableContent).toContain(
      "\n![景别示例](https://cdn.example.com/shot-size.png) 640x360\n",
    );
    expect(decision.readableContent).toContain("\n| 角度 | 作用 | 适合场景 |\n");
    expect(decision.readableContent).toContain("\n## 抓取记录\n");
    expect(decision.artifact.textPreview).toContain("\n### 一、景别\n");
    expect((decision.artifact as unknown as Record<string, unknown>).readableContent).toContain(
      "\n| 仰视 | 增强力量感 | 英雄登场 |\n",
    );
    expect(
      (decision.artifact as unknown as Record<string, unknown>).structuredContent,
    ).toMatchObject({
      schemaVersion: "director.source.snapshot.v1",
      kind: "browser-capture",
    });
  });

  it("quarantines diary-like chatter before it can become an experience candidate", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "local-text",
      sourceId: "casual_diary",
      sourceKind: "pasted-text",
      sourceRef: "desktop://composer",
      title: "随口记录",
      rawContent:
        "我今天学习制作咖啡，挺开心。天气也不错，就随便聊聊，和朋友说了一些日常，只是流水账和心情记录。",
      privacy: "internal",
      provenance: "test/admission",
      capturedAtMs: 5_000,
      quarantineNotes: [
        "Pasted learning must contain reusable guidance before candidate creation.",
      ],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: expect.arrayContaining(["conversation noise rather than reusable guidance"]),
    });
    expect(decision.quarantine?.reason).toBe("conversation noise rather than reusable guidance");
  });

  it("applies caller-provided admission rules before candidate creation", () => {
    const admission = new HeuristicExperienceAdmissionAdapter({
      extraRules: [
        {
          ruleId: "operator-blocklist",
          evaluate: ({ readableContent }) =>
            readableContent.includes("do not learn")
              ? {
                  reason: "operator admission policy blocked source",
                  scoreDelta: -100,
                  metrics: { policy: "operator-blocklist" },
                }
              : null,
        },
      ],
    });

    const decision = admission.admit({
      profile: "local-text",
      sourceId: "desktop_lessons",
      sourceKind: "local-directory",
      sourceRef: "file:///Desktop/AngelLessons#blocked.md",
      path: "blocked.md",
      title: "blocked.md",
      rawContent: "Preserve evidence but do not learn this draft until the operator approves it.",
      privacy: "confidential",
      provenance: "test/admission",
      capturedAtMs: 2_000,
      quarantineNotes: ["Local learning requires reusable text before candidate creation."],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: ["operator admission policy blocked source"],
    });
    expect(decision.quarantine?.reason).toBe("operator admission policy blocked source");
    expect(decision.artifact.quality.metrics).toMatchObject({
      ruleIds: ["operator-blocklist"],
    });
  });

  it("turns fetch failures into quarantined source artifacts", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "fetch-failure",
      sourceId: "locked_url",
      sourceKind: "web-page",
      sourceRef: "https://example.com/locked",
      title: "example.com",
      rawContent: "Fetch failed for https://example.com/locked: HTTP 403",
      fetchErrorMessage: "HTTP 403",
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 3_000,
      quarantineNotes: ["Source fetch must succeed before candidate creation."],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.rawContent).toContain("HTTP 403");
    expect(decision.artifact.quality).toMatchObject({
      score: 0,
      verdict: "quarantine",
      reasons: ["source fetch failed before readable source content"],
      metrics: {
        error: "HTTP 403",
      },
    });
    expect(decision.quarantine).toMatchObject({
      reason: "source fetch failed before readable source content",
      notes: ["Source fetch must succeed before candidate creation."],
    });
  });

  it("quarantines X JavaScript shells instead of admitting them as learned source content", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const xShell = [
      "JavaScript is not available.",
      "We’ve detected that JavaScript is disabled in this browser.",
      "Please enable JavaScript or switch to a supported browser to continue using x.com.",
      "Something went wrong, but don’t fret — let’s give it another shot.",
      "Some privacy related extensions may cause issues on x.com.",
      "window.__SCRIPTS_LOADED__ = {};",
      'SENTRY_RELEASE={id:"686285c17247d3d7a9f25f3d"};',
      "function _typeof(o){ return typeof o; }",
      "Use ESM export syntax to keep this module tree-shakeable.",
    ].join(" ");

    const decision = admission.admit({
      profile: "web-text",
      sourceId: "x_status",
      sourceKind: "web-page",
      sourceRef: "https://x.com/bmx_ai13/status/2054021743467970934?s=46",
      title: "x.com",
      contentType: "text/plain",
      rawContent: xShell,
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 6_000,
      quarantineNotes: ["Direct URL learning requires readable source content."],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: expect.arrayContaining(["dynamic application shell rather than source content"]),
    });
    expect(decision.artifact.quality.metrics).toMatchObject({
      dynamicShellMarkerHits: expect.any(Number),
    });
    expect(decision.quarantine?.reason).toBe(
      "dynamic application shell rather than source content",
    );
  });

  it("quarantines minified X bundle fragments even when the page hides obvious login copy", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "web-text",
      sourceId: "x_status",
      sourceKind: "web-page",
      sourceRef: "https://x.com/cellinlab/status/2054424434736349433",
      title: "x.com",
      contentType: "text/plain",
      rawContent: [
        'a&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[a]="0583100a-cd41-43dd-8d44-06ac3498f2e2")',
        'e._sentryDebugIdIdentifier="sentry-dbid-0583100a-cd41-43dd-8d44-06ac3498f2e2"',
        "f.o=(e,a)=>Object.prototype.hasOwnProperty.call(e,a),i={},f.l=(e,a,r,n)=>{if(i[e])return void i[e].push(a)}",
        "Use ESM export syntax, instead: +e.id",
      ].join(";"),
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 8_000,
      quarantineNotes: ["Direct URL learning requires readable source content."],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: expect.arrayContaining(["dynamic application shell rather than source content"]),
      metrics: expect.objectContaining({
        sourceAccessStatus: "source_access_limited",
      }),
    });
    expect(decision.quarantine?.reason).toBe(
      "dynamic application shell rather than source content",
    );
  });

  it("quarantines Weixin verification pages instead of admitting environment error text", () => {
    const admission = new HeuristicExperienceAdmissionAdapter();

    const decision = admission.admit({
      profile: "web-text",
      sourceId: "weixin_article",
      sourceKind: "web-page",
      sourceRef: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      title: "mp.weixin.qq.com",
      contentType: "text/html",
      rawContent: [
        "<html><body>",
        "环境异常 当前环境异常，完成验证后即可继续访问。",
        "视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看",
        "</body></html>",
      ].join(""),
      privacy: "public",
      provenance: "test/admission",
      capturedAtMs: 7_000,
      quarantineNotes: ["Direct URL learning requires readable source content."],
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.artifact.quality).toMatchObject({
      verdict: "quarantine",
      reasons: expect.arrayContaining(["source access challenge rather than source content"]),
    });
    expect(decision.quarantine?.reason).toBe("source access challenge rather than source content");
  });
});
