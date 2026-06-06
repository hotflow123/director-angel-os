import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HeuristicExperienceAdmissionAdapter } from "../src/experience-admission.js";
import { FileExperienceStore } from "../src/experience-store.js";
import {
  LocalDirectoryExperienceAdapter,
  PastedTextExperienceAdapter,
  SelfLearningOrchestrator,
  WebExperienceSourceAdapter,
  WebSearchExperienceAdapter,
} from "../src/self-learning.js";

describe("SelfLearningOrchestrator", () => {
  it("learns from a user-provided local directory and selected web pages into stored candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-self-learning-"));
    const desktopDir = join(workspaceRoot, "Desktop", "AngelLessons");
    const experienceDir = join(workspaceRoot, "experience");

    try {
      mkdirSync(join(desktopDir, "nested"), { recursive: true });
      writeFileSync(
        join(desktopDir, "director-notes.md"),
        [
          "# Director lesson",
          "",
          "When a scene is ambiguous, ask for constraints before generating assets.",
        ].join("\n"),
      );
      writeFileSync(
        join(desktopDir, "nested", "shot-list.txt"),
        "Keep continuity anchors visible in every handoff.",
      );
      writeFileSync(join(desktopDir, "ignored.bin"), "\u0000\u0001");

      const store = new FileExperienceStore({ experienceDir });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [
          new LocalDirectoryExperienceAdapter({
            sourceId: "desktop_lessons",
            directoryRoot: desktopDir,
            privacy: "confidential",
            nowMs: () => 1_000,
          }),
          new WebExperienceSourceAdapter({
            sourceId: "public_direction_guide",
            urls: ["https://example.com/directing-guide"],
            fetchText: async (url) => ({
              url,
              contentType: "text/html",
              body: [
                "<html><head><title>Direction guide</title><script>ignore()</script></head>",
                "<body><h1>Direction guide</h1><p>Use dry-run review before external production.</p></body></html>",
              ].join(""),
            }),
            nowMs: () => 2_000,
          }),
        ],
      });

      const first = await orchestrator.learn();
      const second = await orchestrator.learn({ sinceCursors: first.nextCursors });
      const stored = await store.listCandidates();

      expect(first.status).toBe("ok");
      expect(first.candidateCount).toBe(3);
      expect(first.nextCursors).toMatchObject({
        local_directory_desktop_lessons: expect.stringMatching(/^sha256:/),
        web_page_public_direction_guide: expect.stringMatching(/^sha256:/),
      });
      expect(second.candidateCount).toBe(0);
      expect(stored).toHaveLength(3);
      expect(
        stored.every(
          (candidate) =>
            candidate.sourceDigest?.startsWith("sha256:") &&
            candidate.quality?.verdict === "usable" &&
            candidate.evidencePreview !== undefined &&
            candidate.evidencePreview.length > 0,
        ),
      ).toBe(true);
      expect(stored.map((candidate) => candidate.sourceAdapter.sourceKind).sort()).toEqual([
        "local-directory",
        "local-directory",
        "web-page",
      ]);
      expect(stored.every((candidate) => candidate.runtimeInjection === "disabled")).toBe(true);
      expect(stored.map((candidate) => candidate.tags)).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(["source:local-directory", "directory:desktop_lessons"]),
          expect.arrayContaining(["source:web-page", "web:public_direction_guide"]),
        ]),
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe web URLs before fetching", async () => {
    const adapter = new WebExperienceSourceAdapter({
      sourceId: "unsafe",
      urls: ["file:///Users/example/Desktop/private.md"],
      fetchText: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(adapter.ingest()).rejects.toThrow("http or https");
  });

  it("quarantines Weixin environment residue during direct URL learning instead of creating candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-url-quality-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new WebExperienceSourceAdapter({
        sourceId: "weixin_public_article",
        urls: ["https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA"],
        fetchText: async (url) => ({
          url,
          contentType: "text/html",
          body: [
            "<html><head><title>微信公众平台</title></head><body>",
            "环境异常 当前环境异常，完成验证后即可继续访问。",
            "视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看",
            "</body></html>",
          ].join(""),
        }),
        nowMs: () => 7_200,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const artifacts = await store.listSourceArtifacts();
      const quarantined = await store.listQuarantines();

      expect(result.status).toBe("ok");
      expect(result.candidateCount).toBe(0);
      expect(result.artifactCount).toBe(1);
      expect(result.quarantineCount).toBe(1);
      expect(result.adapterReports[0]).toMatchObject({
        candidateCount: 0,
        quarantineCount: 1,
        storedQuarantineCount: 1,
      });
      expect(stored).toEqual([]);
      expect(artifacts[0]).toMatchObject({
        sourceRef: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
        quality: {
          verdict: "quarantine",
          reasons: expect.arrayContaining(["source access challenge rather than source content"]),
          metrics: expect.objectContaining({
            sourceAccessStatus: "source_access_limited",
          }),
        },
      });
      expect(quarantined[0]).toMatchObject({
        reason: "source access challenge rather than source content",
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("searches the web by topic and stores fetched result pages as experience candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-web-search-learning-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new WebSearchExperienceAdapter({
        sourceId: "director_workflow_search",
        queries: ["director agent learning workflow"],
        maxResultsPerQuery: 2,
        search: async (query) => [
          {
            url: "https://example.com/director-workflow",
            title: "Director workflow",
            snippet: `Result for ${query}`,
          },
          {
            url: "https://example.com/review-gates",
            title: "Review gates",
            snippet: "Use review gates before applying learned guidance.",
          },
        ],
        fetchText: async (url) => ({
          url,
          contentType: "text/html",
          body: url.endsWith("review-gates")
            ? "<html><title>Review gates</title><body>Keep learned experience candidate-only until reviewed.</body></html>"
            : "<html><title>Director workflow</title><body>Compare sources, extract patterns, and keep evidence.</body></html>",
        }),
        nowMs: () => 3_000,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const first = await orchestrator.learn();
      const second = await orchestrator.learn({ sinceCursors: first.nextCursors });
      const stored = await store.listCandidates();

      expect(first.status).toBe("ok");
      expect(first.candidateCount).toBe(2);
      expect(first.adapterReports[0]).toMatchObject({
        sourceKind: "web-search",
        candidateCount: 2,
        storedCount: 2,
      });
      expect(second.candidateCount).toBe(0);
      expect(stored).toHaveLength(2);
      expect(stored.every((candidate) => candidate.sourceAdapter.sourceKind === "web-search")).toBe(
        true,
      );
      expect(stored[0]?.tags).toEqual(
        expect.arrayContaining(["source:web-search", "query:director_agent_learning_workflow"]),
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("learns pasted long text as a preserved source snapshot and review-gated experience", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-pasted-text-learning-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new PastedTextExperienceAdapter({
        sourceId: "ai_short_drama_notes",
        texts: [
          {
            title: "AI短剧基础知识",
            content: [
              "AI短剧基础知识",
              "一、景别：大特写、特写、近景、中景、全景、远景。",
              "推荐流程：先确认画面目的，再选择景别、角度、构图、光影和运镜。",
              "审核时需要保留来源证据，避免把登录提示、图片占位或广告文案当成经验。",
            ].join("\n"),
          },
        ],
        nowMs: () => 8_000,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const first = await orchestrator.learn();
      const second = await orchestrator.learn({ sinceCursors: first.nextCursors });
      const stored = await store.listCandidates();
      const artifacts = await store.listSourceArtifacts();

      expect(first.status).toBe("ok");
      expect(first.adapterReports[0]).toMatchObject({
        sourceKind: "pasted-text",
        candidateCount: 1,
        storedCount: 1,
      });
      expect(second.candidateCount).toBe(0);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.sourceAdapter.sourceKind).toBe("pasted-text");
      expect(stored[0]?.tags).toEqual(
        expect.arrayContaining(["source:pasted-text", "pasted:ai_short_drama_notes"]),
      );
      expect(stored[0]?.summary).toContain("经验提炼");
      expect(stored[0]?.evidencePreview).toContain("先确认画面目的");
      expect(artifacts[0]?.readableContent).toContain("AI短剧基础知识");
      expect(artifacts[0]?.extractionReport?.status).toBe("ok");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("distills readable source content into reusable experience instead of raw page openers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-web-distillation-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [
          new WebExperienceSourceAdapter({
            sourceId: "ai_short_drama_basics",
            urls: ["https://example.com/ai-short-drama"],
            fetchText: async (url) => ({
              url,
              contentType: "text/html",
              structuredContent: {
                schemaVersion: "director.source.snapshot.v1",
                kind: "browser-capture",
                blocks: [
                  { kind: "heading", level: 1, text: "AI短剧基础知识" },
                  {
                    kind: "text",
                    text: "推荐流程：先确认画面目的，再选择景别、角度、构图、光影和运镜。",
                  },
                ],
                tables: [
                  {
                    caption: "景别",
                    rows: [
                      ["景别", "作用"],
                      ["特写", "强化情绪"],
                    ],
                  },
                ],
                media: [
                  {
                    kind: "image",
                    src: "https://example.com/shot.png",
                    alt: "景别示意图",
                  },
                ],
              },
              body: [
                "<html><head><title>AI短剧基础知识</title></head><body>",
                "<h1>AI短剧基础知识</h1>",
                "<p>一、景别。共分为八种：大特写、特写、近景、中景、全景、远景。</p>",
                "<p>推荐流程：先确认画面目的，再选择景别、角度、构图、光影和运镜。</p>",
                "<p>审核时需要保留来源证据，避免把登录提示、图片占位或广告文案当成经验。</p>",
                "</body></html>",
              ].join(""),
            }),
            nowMs: () => 7_000,
          }),
        ],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const artifacts = await store.listSourceArtifacts();

      expect(result.status).toBe("ok");
      expect(stored).toHaveLength(1);
      expect(stored[0]?.summary).toContain("经验提炼");
      expect(stored[0]?.summary).toContain("先确认画面目的");
      expect(stored[0]?.summary).not.toMatch(/^AI短剧基础知识/u);
      expect(stored[0]?.tags).toEqual(
        expect.arrayContaining(["distilled-experience", "distillation:high"]),
      );
      expect(stored[0]?.evidence[0]?.summary).toContain("先确认画面目的");
      expect(stored[0]?.evidencePreview).toContain("AI短剧基础知识");
      expect(artifacts[0]?.structuredContent).toMatchObject({
        schemaVersion: "director.source.snapshot.v1",
        kind: "browser-capture",
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("uses an injected model distiller before falling back to heuristic distillation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-model-distillation-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [
          new WebExperienceSourceAdapter({
            sourceId: "model_distilled_guide",
            urls: ["https://example.com/model-guide"],
            distiller: {
              distillerId: "test-model-distiller",
              distill: async () => ({
                summary:
                  "模型提炼：拍摄前先锁定目标、镜头尺度和审核证据，再把可复用规则交给人工审查。",
                applicability:
                  "Use when Director Angel learns production guidance from source material.",
                risks: ["模型提炼仍需人工复核，不能直接发布为运行时知识。"],
                tags: ["model-authored"],
                evidenceSummary: "模型提炼证据：原文要求先锁定目标并保留审核证据。",
                confidence: "high",
                selectedClaims: ["先锁定目标、镜头尺度和审核证据。"],
              }),
            },
            fetchText: async (url) => ({
              url,
              contentType: "text/html",
              body: [
                "<html><title>Model guide</title><body>",
                "<p>Raw opener that should stay only as evidence.</p>",
                "<p>推荐流程：先锁定目标、镜头尺度和审核证据。</p>",
                "</body></html>",
              ].join(""),
            }),
            nowMs: () => 7_500,
          }),
        ],
      });

      await orchestrator.learn();
      const stored = await store.listCandidates();

      expect(stored).toHaveLength(1);
      expect(stored[0]?.summary).toContain("模型提炼");
      expect(stored[0]?.summary).not.toContain("Raw opener");
      expect(stored[0]?.tags).toEqual(
        expect.arrayContaining(["distillation:model", "distiller:test_model_distiller"]),
      );
      expect(stored[0]?.evidence[0]?.summary).toContain("模型提炼证据");
      expect(stored[0]?.evidencePreview).toContain("Raw opener");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("quarantines script and CSS noise from web search results instead of storing garbage candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-web-search-quality-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new WebSearchExperienceAdapter({
        sourceId: "feishu_url_mistake",
        queries: ["去学习这个https://bcn5ot9wwnew.feishu.cn/wiki/doc"],
        maxResultsPerQuery: 2,
        search: async () => [
          {
            url: "https://www.feishu.cn/noisy",
            title: "Use the web version of Feishu",
          },
          {
            url: "https://example.com/real-director-lesson",
            title: "Real director lesson",
          },
        ],
        fetchText: async (url) => ({
          url,
          contentType: "text/html",
          body: url.includes("noisy")
            ? [
                "<html><title>Use the web version of Feishu</title><body>",
                '"use strict";function _typeof(obj){"@babel/helpers - typeof";return _typeof="function";}',
                "@media screen and (max-width:904px){[data-elem-id=Q2PzC65oxi]{padding:24px 0 0}}",
                "</body></html>",
              ].join("")
            : "<html><title>Real director lesson</title><body>Compare the source, preserve evidence, and only save review-worthy operating guidance.</body></html>",
        }),
        nowMs: () => 4_000,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const quarantined = await store.listQuarantines();

      expect(result.status).toBe("ok");
      expect(result.candidateCount).toBe(1);
      expect(result.quarantineCount).toBe(1);
      expect(result.adapterReports[0]?.notes.join(" ")).toContain("Skipped");
      expect(result.adapterReports[0]).toMatchObject({
        quarantineCount: 1,
        storedQuarantineCount: 1,
      });
      expect(stored).toHaveLength(1);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).toMatchObject({
        reason: "script or CSS noise rather than reusable guidance",
        artifact: {
          sourceRef: "https://www.feishu.cn/noisy",
          quality: {
            verdict: "quarantine",
          },
        },
      });
      expect(stored[0]?.title).toContain("Real director lesson");
      expect(stored[0]?.summary).not.toContain("@babel/helpers");
      expect(stored[0]?.summary).not.toContain("data-elem-id");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("quarantines local script and CSS noise instead of storing desktop garbage candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-local-learning-quality-"));
    const desktopDir = join(workspaceRoot, "Desktop", "AngelLessons");
    const experienceDir = join(workspaceRoot, "experience");

    try {
      mkdirSync(desktopDir, { recursive: true });
      writeFileSync(
        join(desktopDir, "lesson.md"),
        "Preserve evidence, compare references, and keep learning review-gated before publishing.",
      );
      writeFileSync(
        join(desktopDir, "bundle.js"),
        [
          '"use strict";function _typeof(obj){"@babel/helpers - typeof";return _typeof="function";}',
          "@media screen and (max-width:904px){[data-elem-id=Q2PzC65oxi]{display:flex;padding:24px}}",
        ].join("\n"),
      );

      const store = new FileExperienceStore({ experienceDir });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [
          new LocalDirectoryExperienceAdapter({
            sourceId: "desktop_quality",
            directoryRoot: desktopDir,
            nowMs: () => 6_000,
          }),
        ],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const artifacts = await store.listSourceArtifacts();
      const quarantined = await store.listQuarantines();

      expect(result.status).toBe("ok");
      expect(result.candidateCount).toBe(1);
      expect(result.artifactCount).toBe(2);
      expect(result.quarantineCount).toBe(1);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.title).toContain("lesson.md");
      expect(artifacts).toHaveLength(2);
      expect(artifacts.every((artifact) => artifact.rawContent !== undefined)).toBe(true);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).toMatchObject({
        reason: "script or CSS noise rather than reusable guidance",
        artifact: {
          path: "bundle.js",
          quality: {
            verdict: "quarantine",
          },
        },
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("routes local learning through an injected admission adapter", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-injected-admission-"));
    const desktopDir = join(workspaceRoot, "Desktop", "AngelLessons");
    const experienceDir = join(workspaceRoot, "experience");

    try {
      mkdirSync(desktopDir, { recursive: true });
      writeFileSync(
        join(desktopDir, "blocked.md"),
        "Preserve evidence, but do not learn this draft until the operator approves it.",
      );

      const admission = new HeuristicExperienceAdmissionAdapter({
        extraRules: [
          {
            ruleId: "operator-blocklist",
            evaluate: ({ readableContent }) =>
              readableContent.includes("do not learn")
                ? {
                    reason: "operator admission policy blocked source",
                    scoreDelta: -100,
                  }
                : null,
          },
        ],
      });
      const store = new FileExperienceStore({ experienceDir });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [
          new LocalDirectoryExperienceAdapter({
            sourceId: "desktop_injected_admission",
            directoryRoot: desktopDir,
            admission,
            nowMs: () => 6_500,
          }),
        ],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const quarantined = await store.listQuarantines();

      expect(result.candidateCount).toBe(0);
      expect(result.quarantineCount).toBe(1);
      expect(stored).toEqual([]);
      expect(quarantined[0]).toMatchObject({
        reason: "operator admission policy blocked source",
        artifact: {
          quality: {
            verdict: "quarantine",
          },
        },
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe web search result URLs before fetching", async () => {
    const adapter = new WebSearchExperienceAdapter({
      sourceId: "unsafe_search",
      queries: ["unsafe"],
      search: async () => [
        {
          url: "file:///Users/example/private.md",
          title: "Unsafe local file",
        },
      ],
      fetchText: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(adapter.ingest()).rejects.toThrow("http or https");
  });

  it("quarantines low-quality selected web pages while storing only review-worthy candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-web-page-quarantine-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new WebExperienceSourceAdapter({
        sourceId: "mixed_web_pages",
        urls: [
          "https://example.com/director-lesson",
          "https://example.com/login",
          "https://example.com/noisy-shell",
        ],
        fetchText: async (url) => ({
          url,
          contentType: "text/html",
          body: url.endsWith("login")
            ? "<html><title>Login</title><body>Sign in to continue before reading this page.</body></html>"
            : url.endsWith("noisy-shell")
              ? [
                  "<html><title>Shell</title><body>",
                  '"use strict";function _typeof(obj){"@babel/helpers - typeof";return _typeof="function";}',
                  "@media screen and (max-width:904px){[data-elem-id=Q2PzC65oxi]{padding:24px 0 0}}",
                  "</body></html>",
                ].join("")
              : "<html><title>Director lesson</title><body>Preserve evidence, compare the source, and only save reusable operating guidance after review.</body></html>",
        }),
        nowMs: () => 5_000,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const quarantined = await store.listQuarantines();

      expect(result.status).toBe("ok");
      expect(result.candidateCount).toBe(1);
      expect(result.quarantineCount).toBe(2);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        sourceDigest: expect.stringMatching(/^sha256:/),
        quality: {
          verdict: "usable",
        },
      });
      expect(stored[0]?.evidencePreview).toContain("Preserve evidence");
      expect(quarantined.map((entry) => entry.reason).sort()).toEqual([
        "authentication page rather than source content",
        "script or CSS noise rather than reusable guidance",
      ]);
      expect(quarantined.every((entry) => entry.artifact.textPreview.length > 0)).toBe(true);
      expect(quarantined.every((entry) => entry.artifact.digest.startsWith("sha256:"))).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("quarantines direct URL fetch failures instead of returning an empty degraded run", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-web-fetch-quarantine-"));
    const experienceDir = join(workspaceRoot, "experience");

    try {
      const store = new FileExperienceStore({ experienceDir });
      const adapter = new WebExperienceSourceAdapter({
        sourceId: "fetch_failure",
        urls: ["https://example.com/locked"],
        fetchText: async () => {
          throw new Error("HTTP 403");
        },
        nowMs: () => 7_000,
      });
      const orchestrator = new SelfLearningOrchestrator({
        store,
        adapters: [adapter],
      });

      const result = await orchestrator.learn();
      const stored = await store.listCandidates();
      const artifacts = await store.listSourceArtifacts();
      const quarantined = await store.listQuarantines();

      expect(result.status).toBe("ok");
      expect(result.candidateCount).toBe(0);
      expect(result.artifactCount).toBe(1);
      expect(result.quarantineCount).toBe(1);
      expect(result.adapterReports[0]).toMatchObject({
        quarantineCount: 1,
        storedQuarantineCount: 1,
      });
      expect(result.adapterReports[0]?.notes.join(" ")).toContain("HTTP 403");
      expect(stored).toEqual([]);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        sourceRef: "https://example.com/locked",
        quality: {
          verdict: "quarantine",
          reasons: ["source fetch failed before readable source content"],
        },
      });
      expect(artifacts[0]?.rawContent).toContain("HTTP 403");
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).toMatchObject({
        reason: "source fetch failed before readable source content",
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
