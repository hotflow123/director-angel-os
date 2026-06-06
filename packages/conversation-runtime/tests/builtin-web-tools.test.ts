import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBuiltinWebToolExecutors,
  createBuiltinWebTools,
  createFileConversationRuntimeWebExtractArtifactReader,
  createFileConversationRuntimeWebExtractArtifactStore,
} from "../src/index.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("built-in web tools", () => {
  it("defines web_search as a read-only model-visible search tool", () => {
    const [webSearch] = createBuiltinWebTools().filter((tool) => tool.name === "web_search");

    expect(webSearch).toMatchObject({
      name: "web_search",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.search",
        source: "built-in",
      }),
    });
    expect(webSearch?.description).toContain("Search");
    expect(webSearch?.inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        provider: {
          enum: ["auto", "brave", "duckduckgo", "exa", "firecrawl", "sogou-weixin"],
        },
        source_type: {
          enum: ["web", "weixin_article", "official_site"],
        },
      },
    });
  });

  it("defines web_extract as a read-only model-visible URL extraction tool", () => {
    const [webExtract] = createBuiltinWebTools().filter((tool) => tool.name === "web_extract");

    expect(webExtract).toMatchObject({
      name: "web_extract",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.extract",
        source: "built-in",
      }),
    });
    expect(webExtract?.description).toContain("Extract");
    expect(webExtract?.inputSchema).toMatchObject({
      type: "object",
      required: ["url"],
      additionalProperties: false,
    });
  });

  it("defines web_extract_artifact_read as a read-only ref-backed full body reader", () => {
    const [artifactRead] = createBuiltinWebTools().filter(
      (tool) => tool.name === "web_extract_artifact_read",
    );

    expect(artifactRead).toMatchObject({
      name: "web_extract_artifact_read",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.extract.artifact.read",
        source: "built-in",
      }),
    });
    expect(artifactRead?.description).toContain("Read");
    expect(artifactRead?.inputSchema).toMatchObject({
      type: "object",
      required: ["full_body_ref"],
      additionalProperties: false,
    });
  });

  it("executes web_search as source discovery without creating learning candidates", async () => {
    const searchCalls = [];
    const executors = createBuiltinWebToolExecutors({
      search: async (input) => {
        searchCalls.push(input);
        return {
          query: input.query,
          provider: input.provider,
          sourceType: input.sourceType,
          results: [
            {
              title: "Seedance tutorial",
              url: "https://example.test/seedance",
              snippet: "Camera movement and prompt examples.",
              source: "test-provider",
            },
          ].slice(0, input.maxResults),
        };
      },
    });
    const execute = executors.get("web_search");
    expect(execute).toBeDefined();

    const result = await execute?.({
      turnId: "turn-web-search",
      sessionKey: "session-1",
      call: {
        id: "call-web-search",
        name: "web_search",
        args: {
          query: "Seedance latest tutorial",
          max_results: 3,
          provider: "duckduckgo",
          source_type: "web",
          reason: "普通互联网资料搜索",
        },
      },
    });

    expect(searchCalls).toEqual([
      expect.objectContaining({
        provider: "duckduckgo",
        sourceType: "web",
        reason: "普通互联网资料搜索",
      }),
    ]);
    expect(result).toMatchObject({
      callId: "call-web-search",
      toolName: "web_search",
      ok: true,
      output: {
        status: "success",
        query: "Seedance latest tutorial",
        provider: "duckduckgo",
        source_type: "web",
        results: [
          {
            title: "Seedance tutorial",
            url: "https://example.test/seedance",
            source: "test-provider",
          },
        ],
        next_actions: ["extract promising URLs with web_extract"],
      },
    });
    expect(result?.content).toContain("status: success");
    expect(result?.content).toContain("provider: duckduckgo");
    expect(result?.content).toContain("source_type: web");
    expect(result?.content).toContain("candidate_count: 0");
    expect(result?.content).toContain("next_actions: extract promising URLs with web_extract");
  });

  it("routes WeChat public account article searches through the Sogou Weixin provider", async () => {
    const fetchCalls = [];
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => `
            <html>
              <body>
                <div class="news-box">
                  <ul class="news-list">
                    <li>
                      <h3><a target="_blank" href="https://mp.weixin.qq.com/s/seedance-a">Seedance2.0 保姆级教程</a></h3>
                      <p class="txt-info">公众号文章摘要：镜头、提示词、工作流。</p>
                      <a class="account" href="/weixin?type=1&query=AI导演">AI导演</a>
                    </li>
                  </ul>
                </div>
              </body>
            </html>
          `,
        };
      },
    });
    const execute = executors.get("web_search");

    const result = await execute?.({
      turnId: "turn-sogou-weixin-search",
      sessionKey: "session-1",
      call: {
        id: "call-sogou-weixin",
        name: "web_search",
        args: {
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
          max_results: 5,
          reason: "用户明确要求用搜狗搜索微信公众号文章",
        },
      },
    });

    expect(fetchCalls[0]).toContain("https://weixin.sogou.com/weixin");
    expect(fetchCalls[0]).toContain("type=2");
    expect(new URL(fetchCalls[0] ?? "").searchParams.get("query")).toBe("seedance2.0 教程");
    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "success",
        provider: "sogou-weixin",
        source_type: "weixin_article",
        query: "seedance2.0 教程",
        results: [
          {
            title: "Seedance2.0 保姆级教程",
            url: "https://mp.weixin.qq.com/s/seedance-a",
            source: "sogou-weixin",
          },
        ],
        failures: [],
      },
    });
    expect(result?.content).toContain("provider: sogou-weixin");
    expect(result?.content).toContain("source_type: weixin_article");
    expect(result?.content).toContain("Seedance2.0 保姆级教程");
  });

  it("parses browser-rendered DuckDuckGo search text when the desktop fetcher already opened the page", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://html.duckduckgo.com/html/?q=AI%20%E7%94%9F%E6%88%90%E5%9B%BE%E7%89%87%20%E5%88%86%E9%95%9C%E5%9B%BE%20%E6%A8%A1%E5%9E%8B%202025-2026",
        headers: { get: () => "text/plain; charset=utf-8" },
        text: async () => `
          AI 生成图片 分镜图 模型 2025-2026 at DuckDuckGo
          https://html.duckduckgo.com/html/?q=AI%20生成图片%20分镜图%20模型%202025-2026

          ## 页面内容

          一口气出整套分镜!四款AI生图工具横评，谁才是创作者的图片王者？
          zhuanlan.zhihu.com/p/1952762165057544921
          大家好，我是春华秋实，一名专注内容创作的独立博主。

          Qwen-Image - 阿里开源AI图像生成模型，中文文本渲染领先
          qwenimages.com/zh
          Qwen-Image 是阿里巴巴通义千问团队开源的 20B 参数模型。

          VisionY - AI分镜生成平台，自动识别场景、角色和对话
          ai-bot.cn/visiony/
          VisionY 是基于 AI 技术将剧本转化为专业分镜的平台。
        `,
      }),
    });
    const execute = executors.get("web_search");

    const result = await execute?.({
      turnId: "turn-duckduckgo-rendered-text",
      sessionKey: "session-1",
      call: {
        id: "call-duckduckgo-rendered-text",
        name: "web_search",
        args: {
          query: "AI 生成图片 分镜图 模型 2025-2026",
          provider: "duckduckgo",
          source_type: "web",
          max_results: 3,
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "success",
        provider: "duckduckgo",
        source_type: "web",
        results: [
          expect.objectContaining({
            title: "一口气出整套分镜!四款AI生图工具横评，谁才是创作者的图片王者？",
            url: "https://zhuanlan.zhihu.com/p/1952762165057544921",
            source: "duckduckgo",
          }),
          expect.objectContaining({
            title: "Qwen-Image - 阿里开源AI图像生成模型，中文文本渲染领先",
            url: "https://qwenimages.com/zh",
            source: "duckduckgo",
          }),
          expect.objectContaining({
            title: "VisionY - AI分镜生成平台，自动识别场景、角色和对话",
            url: "https://ai-bot.cn/visiony/",
            source: "duckduckgo",
          }),
        ],
      },
    });
    expect(result?.content).toContain("result_count: 3");
    expect(result?.content).not.toContain("No web search results found");
  });

  it("filters DuckDuckGo ad and tracking result URLs before exposing source candidates", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://html.duckduckgo.com/html/?q=AI%20video%20generation%20model%202026",
        headers: { get: () => "text/html; charset=utf-8" },
        text: async () => `
          <html><body>
            <a class="result__a" href="/y.js?ad_domain=byteplus.com&amp;u3=https%3A%2F%2Fbyteplus.com%2F">
              Generate Videos with 4 Modes - Generate Videos With Audio
            </a>
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.bing.com%2Faclick%3Fld%3Dad-result">
              Try Artlist's Video Generator - Free AI Video Generator
            </a>
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Frunwayml.com%2Fresearch%2Fgen-4">
              Runway Gen-4 research notes
            </a>
          </body></html>
        `,
      }),
    });
    const execute = executors.get("web_search");

    const result = await execute?.({
      turnId: "turn-duckduckgo-ad-filter",
      sessionKey: "session-1",
      call: {
        id: "call-duckduckgo-ad-filter",
        name: "web_search",
        args: {
          query: "AI video generation model 2026",
          provider: "duckduckgo",
          source_type: "web",
          max_results: 5,
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "success",
        results: [
          expect.objectContaining({
            title: "Runway Gen-4 research notes",
            url: "https://runwayml.com/research/gen-4",
          }),
        ],
      },
    });
    expect(result?.output).toMatchObject({ result_count: 1 });
    expect(result?.output).toMatchObject({
      results: expect.not.arrayContaining([
        expect.objectContaining({ url: expect.stringContaining("byteplus.com") }),
        expect.objectContaining({ url: expect.stringContaining("bing.com/aclick") }),
      ]),
    });
    expect(result?.content).toContain("Runway Gen-4 research notes");
    expect(result?.content).not.toContain("byteplus.com");
    expect(result?.content).not.toContain("bing.com/aclick");
  });

  it("parses current Sogou Weixin /link article results as valid source candidates", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://weixin.sogou.com/weixin?type=2&query=seedance2.0%20%E6%95%99%E7%A8%8B",
        headers: { get: () => "text/html" },
        text: async () => `
          <html><body>
            <ul class="news-list">
              <li id="sogou_vr_11002601_box_0">
                <div class="img-box">
                  <a href="/link?url=encoded&amp;type=2&amp;query=seedance2.0%20%E6%95%99%E7%A8%8B&amp;token=abc">image</a>
                </div>
                <div class="txt-box">
                  <h3>
                    <a target="_blank" href="/link?url=encoded&amp;type=2&amp;query=seedance2.0%20%E6%95%99%E7%A8%8B&amp;token=abc" id="sogou_vr_11002601_title_0">即梦 <em><!--red_beg-->Seedance<!--red_end--></em> <em><!--red_beg-->2.0<!--red_end--></em>保姆级<em><!--red_beg-->教程<!--red_end--></em></a>
                  </h3>
                  <p class="txt-info">本文将为你梳理一份详尽的 Seedance 2.0 教程。</p>
                </div>
              </li>
            </ul>
          </body></html>
        `,
      }),
    });
    const execute = executors.get("web_search");

    const result = await execute?.({
      turnId: "turn-sogou-weixin-current-link",
      sessionKey: "session-1",
      call: {
        id: "call-sogou-weixin-current-link",
        name: "web_search",
        args: {
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
          max_results: 5,
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "success",
        provider: "sogou-weixin",
        source_type: "weixin_article",
        results: [
          {
            title: "即梦 Seedance 2.0保姆级教程",
            url: expect.stringContaining("https://weixin.sogou.com/link?"),
            source: "sogou-weixin",
            snippet: expect.stringContaining("Seedance 2.0 教程"),
          },
        ],
      },
    });
    expect(result?.content).toContain("result_count: 1");
    expect(result?.content).toContain("即梦 Seedance 2.0保姆级教程");
  });

  it("returns a structured blocked result when Sogou Weixin asks for verification", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://weixin.sogou.com/antispider/",
        headers: { get: () => "text/html" },
        text: async () => "<html><title>验证码</title><body>请输入验证码</body></html>",
      }),
    });
    const execute = executors.get("web_search");

    const result = await execute?.({
      turnId: "turn-sogou-weixin-blocked",
      sessionKey: "session-1",
      call: {
        id: "call-sogou-weixin-blocked",
        name: "web_search",
        args: {
          query: "seedance2.0 教程",
          provider: "sogou-weixin",
          source_type: "weixin_article",
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "blocked",
        provider: "sogou-weixin",
        source_type: "weixin_article",
        results: [],
        failures: [expect.stringContaining("verification")],
        next_actions: expect.arrayContaining([
          "open Sogou Weixin search in browser for operator verification",
        ]),
      },
    });
    expect(result?.content).toContain("status: blocked");
    expect(result?.content).toContain("provider: sogou-weixin");
  });

  it("executes web_extract as source extraction without creating learning candidates", async () => {
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "Seedance tutorial",
        contentType: "text/html",
        body: "Seedance camera movement guide with prompt examples.",
        extractionReport: {
          method: "test-provider",
          readableChars: 52,
          rawChars: 100,
          blocked: false,
        },
      }),
    });
    const execute = executors.get("web_extract");
    expect(execute).toBeDefined();

    const result = await execute?.({
      turnId: "turn-web-extract",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract",
        name: "web_extract",
        args: { url: "https://example.test/seedance" },
      },
    });

    expect(result).toMatchObject({
      callId: "call-web-extract",
      toolName: "web_extract",
      ok: true,
      output: {
        status: "success",
        url: "https://example.test/seedance",
        title: "Seedance tutorial",
        candidate_count: 0,
        text_preview: "Seedance camera movement guide with prompt examples.",
        quality: {
          status: "ok",
          score: expect.any(Number),
          reason: "readable-content",
          signals: [],
          publishable: true,
        },
        external_content: {
          source_url: "https://example.test/seedance",
          final_url: "https://example.test/seedance",
          title: "Seedance tutorial",
          content_type: "text/html",
          trust_boundary: "external-web",
        },
        source_snapshot: {
          id: "web-extract-https-example-test-seedance",
          source_kind: "url",
          source_ref: "https://example.test/seedance",
          access_status: "available",
          readable_chars: 52,
        },
        next_actions: ["admit with director.learning.admit or inspect with browser_snapshot"],
      },
    });
    expect(result?.content).toContain("status: success");
    expect(result?.content).toContain("candidate_count: 0");
    expect(result?.content).toContain("quality: ok score=");
    expect(result?.content).toContain("source_snapshot: web-extract-https-example-test-seedance");
    expect(result?.content).toContain("text_preview: Seedance camera movement guide");
    expect(result?.output).not.toHaveProperty("body_ref");
    expect(result?.output).not.toHaveProperty("full_body_ref");
    expect(result?.content).not.toContain("body_ref:");
  });

  it("falls back across web_extract providers and records every provider attempt", async () => {
    const providerCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async () => {
        throw new Error("default fetch should not run when extractProviders are configured");
      }) as typeof fetch,
      extractProviders: [
        {
          id: "primary-fetch",
          label: "Primary Fetch",
          timeoutMs: 5_000,
          extract: async ({ url }) => {
            providerCalls.push(`primary:${url}`);
            throw new Error("HTTP 403 from primary");
          },
        },
        {
          id: "browser-snapshot",
          label: "Browser Snapshot",
          timeoutMs: 15_000,
          extract: async ({ url }) => {
            providerCalls.push(`browser:${url}`);
            return {
              url,
              title: "Fallback article",
              contentType: "text/plain",
              body: "Browser fallback produced readable article text for Director Angel.",
              extractionReport: {
                method: "browser_snapshot",
                provider: "browser-snapshot",
              },
            };
          },
        },
      ],
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-provider-fallback",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-provider-fallback",
        name: "web_extract",
        args: { url: "https://example.test/provider-fallback" },
      },
    });

    expect(providerCalls).toEqual([
      "primary:https://example.test/provider-fallback",
      "browser:https://example.test/provider-fallback",
    ]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "success",
        title: "Fallback article",
        text_preview: expect.stringContaining("Browser fallback produced readable article text"),
        extraction_report: expect.objectContaining({
          provider: "browser-snapshot",
          provider_label: "Browser Snapshot",
          provider_attempts: [
            expect.objectContaining({
              provider_id: "primary-fetch",
              provider_label: "Primary Fetch",
              status: "error",
              failure: "HTTP 403 from primary",
              elapsed_ms: expect.any(Number),
            }),
            expect.objectContaining({
              provider_id: "browser-snapshot",
              provider_label: "Browser Snapshot",
              status: "success",
              elapsed_ms: expect.any(Number),
            }),
          ],
        }),
      }),
    });
    expect(result?.content).toContain("status: success");
    expect(result?.content).toContain("provider_attempts:");
    expect(result?.content).toContain("primary-fetch:error");
    expect(result?.content).toContain("browser-snapshot:success");
  });

  it("returns every provider failure when all web_extract providers fail", async () => {
    const executors = createBuiltinWebToolExecutors({
      extractProviders: [
        {
          id: "fetch-a",
          extract: async () => {
            throw new Error("HTTP 403");
          },
        },
        {
          id: "fetch-b",
          extract: async () => ({
            url: "https://example.test/all-fail",
            body: "   ",
          }),
        },
      ],
    });

    const result = await executors.get("web_extract")?.({
      turnId: "turn-web-extract-all-provider-fail",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-all-provider-fail",
        name: "web_extract",
        args: { url: "https://example.test/all-fail" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "error",
        failures: ["HTTP 403", "extracted page body was empty"],
        extraction_report: expect.objectContaining({
          provider_attempts: [
            expect.objectContaining({ provider_id: "fetch-a", status: "error" }),
            expect.objectContaining({ provider_id: "fetch-b", status: "empty" }),
          ],
        }),
      }),
    });
    expect(result?.content).toContain("provider_attempts: fetch-a:error; fetch-b:empty");
  });

  it("reports discovered media inventory, authorization choices, and budget before media understanding", async () => {
    const body = [
      "视觉案例正文已经读取。",
      "![cover](https://cdn.example.test/storyboard-cover.jpg)",
      "[Video: sample](blob:https://example.test/video-1) poster=https://cdn.example.test/poster.jpg",
      "音频旁白：https://cdn.example.test/narration.mp3",
    ].join("\n");
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "含媒体的制作复盘",
        contentType: "text/markdown",
        body,
        structuredContent: {
          media: [
            {
              type: "image",
              url: "https://cdn.example.test/shot-a.webp",
              width: 1280,
              height: 720,
            },
            {
              type: "video",
              src: "https://cdn.example.test/cutdown.mp4",
              poster: "https://cdn.example.test/cutdown-poster.jpg",
              durationSeconds: 125,
            },
          ],
        },
      }),
    });

    const result = await executors.get("web_extract")?.({
      turnId: "turn-web-extract-media",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-media",
        name: "web_extract",
        args: { url: "https://example.test/media-post" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        media_inventory: expect.objectContaining({
          assetCount: 7,
          imageCount: 2,
          videoCount: 2,
          audioCount: 1,
          posterCount: 2,
          blobCount: 1,
        }),
        mediaEvidenceRefs: expect.arrayContaining([
          expect.objectContaining({
            sourceRef: "https://cdn.example.test/storyboard-cover.jpg",
            status: "listed_only",
            realVisualUnderstanding: false,
            metadata: expect.objectContaining({ mediaType: "image" }),
          }),
          expect.objectContaining({
            sourceRef: "blob:https://example.test/video-1",
            metadata: expect.objectContaining({ mediaType: "video", isBlobReference: true }),
          }),
        ]),
        learning_gate: expect.objectContaining({
          mediaAuthorizationRequest: expect.objectContaining({
            assetCount: 7,
            videoCount: 2,
            audioCount: 1,
            budget: expect.objectContaining({
              tokenLimit: expect.any(Number),
              fileCountLimit: 7,
              videoMinuteLimit: expect.any(Number),
              audioMinuteLimit: expect.any(Number),
              estimatedCostTier: expect.stringMatching(/medium|high/u),
            }),
          }),
        }),
        media_understanding_workflow: expect.objectContaining({
          schemaVersion: "conversation-runtime.media-understanding-workflow.v1",
          status: "authorization_required",
          textEvidenceStatus: "read",
          mediaUnderstandingStatus: "not_understood",
          unauthorizedDisclosure:
            "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
          executionPlan: [],
          authorization: expect.objectContaining({
            mode: "media_inventory",
            question: expect.stringContaining("低成本视觉理解"),
            request: expect.objectContaining({
              assetCount: 7,
              budget: expect.objectContaining({ fileCountLimit: 7 }),
            }),
          }),
          evidenceBackfill: expect.objectContaining({
            admissible: true,
            mediaPublishable: false,
            pendingUnderstandingCount: 0,
          }),
        }),
        evidence_disclosure: expect.objectContaining({
          url: "https://example.test/media-post",
          title: "含媒体的制作复盘",
          full_body_chars: body.length,
          media_count: 7,
          media_understanding_status: "not_understood_without_user_authorization",
        }),
        evidence_provenance: expect.objectContaining({
          schemaVersion: "conversation-runtime.evidence-provenance.v1",
          source: expect.objectContaining({
            sourceRef: "https://example.test/media-post",
            textRead: true,
            readableCharacterCount: body.length,
          }),
          media: expect.objectContaining({
            assetCount: 7,
            listedOnlyCount: 7,
            analyzedCount: 0,
            canUseMediaAsConclusion: false,
          }),
          admission: expect.objectContaining({
            canAdmitTextEvidence: true,
            canAdmitMediaContent: false,
            overall: "text_only",
          }),
        }),
      }),
    });
    expect(result?.content).toContain("media_inventory: assets=7 images=2 videos=2 audios=1");
    expect(result?.content).toContain("media_authorization: recommended=");
    expect(result?.content).toContain("text_read=true media_understood=false");
  });

  it("discovers media assets from raw html elements before readable text cleanup", async () => {
    const html = `
      <html>
        <head><title>HTML Media Evidence</title></head>
        <body>
          <article>
            <p>The readable text should survive without pretending media was understood.</p>
            <img src="https://cdn.example.test/storyboard.jpg" alt="storyboard" />
            <video src="https://cdn.example.test/demo.mp4" poster="https://cdn.example.test/poster.jpg">
              <source src="https://cdn.example.test/demo-hd.webm" type="video/webm" />
            </video>
            <audio src="https://cdn.example.test/narration.mp3"></audio>
          </article>
        </body>
      </html>
    `;
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: async (url) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => html,
        }) as Response,
    });

    const result = await executors.get("web_extract")?.({
      turnId: "turn-web-extract-html-media",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-html-media",
        name: "web_extract",
        args: { url: "https://example.test/html-media" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        media_inventory: expect.objectContaining({
          assetCount: 5,
          imageCount: 1,
          videoCount: 2,
          audioCount: 1,
          posterCount: 1,
        }),
        media_understanding_workflow: expect.objectContaining({
          mediaUnderstandingStatus: "not_understood",
          admission: expect.objectContaining({
            status: "text_admissible_media_list_only",
            canAdmitTextEvidence: true,
            canAdmitMediaContent: false,
          }),
        }),
        evidence_disclosure: expect.objectContaining({
          media_count: 5,
          media_understanding_status: "not_understood_without_user_authorization",
        }),
      }),
    });
    expect(result?.content).toContain("media_inventory: assets=5 images=1 videos=2 audios=1");
  });

  it("keeps long web_extract bodies as evidence while exposing only preview and body refs to the model", async () => {
    const bodyHead =
      "长篇导演经验正文开头：这一段说明如何把用户目标拆成镜头、场景、动作、情绪和执行约束。";
    const bodyTail =
      "长篇导演经验正文结尾：这里是只有完整留证里才应该出现的尾部细节，模型消息不能直接吃到。";
    const longBody = `${bodyHead}\n${"中段经验句子，持续描述分镜、审片、模型选择、参数约束和复盘沉淀。".repeat(120)}\n${bodyTail}`;
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "超长导演经验",
        contentType: "text/plain",
        body: longBody,
        extractionReport: {
          method: "test-provider",
          readableChars: longBody.length,
          rawChars: longBody.length,
          blocked: false,
        },
      }),
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-long-body",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-long-body",
        name: "web_extract",
        args: { url: "https://example.test/long-director-note" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        text_preview: expect.stringContaining(bodyHead),
        body: longBody,
        body_ref: "web-extract-body-https-example-test-long-director-note",
        full_body_ref: "web-extract-full-body-https-example-test-long-director-note",
        preview_chars: expect.any(Number),
        full_body_chars: longBody.length,
        body_truncated_for_model: true,
        extraction_report: expect.objectContaining({
          preview_chars: expect.any(Number),
          full_body_chars: longBody.length,
          body_truncated_for_model: true,
        }),
      }),
      metadata: expect.objectContaining({
        modelVisibleContent: expect.stringContaining(
          "body_ref: web-extract-body-https-example-test-long-director-note",
        ),
      }),
    });
    expect(result?.content).toContain(
      "body_ref: web-extract-body-https-example-test-long-director-note",
    );
    expect(result?.content).toContain("full_body_chars:");
    expect(result?.content).toContain("body_truncated_for_model: true");
    expect(result?.content).not.toContain(bodyTail);
    expect(result?.metadata?.modelVisibleContent).not.toContain(bodyTail);
  });

  it("stores long web_extract bodies as traceable artifacts when an artifact store is configured", async () => {
    const storedArtifacts: unknown[] = [];
    const bodyTail = "完整正文尾部：这句必须在 artifact 里，但不能直接出现在工具观察里。";
    const longBody = `长网页正文开头。${"导演知识、网页读取、分镜经验、执行约束。".repeat(180)}${bodyTail}`;
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "长网页正文",
        contentType: "text/plain",
        body: longBody,
      }),
      storeExtractArtifact: async (artifact) => {
        storedArtifacts.push(artifact);
        return {
          id: artifact.fullBodyRef,
          kind: "web-extract-body",
          path: `/tmp/${artifact.fullBodyRef}.json`,
          title: artifact.title,
          metadata: {
            bodyRef: artifact.bodyRef,
            fullBodyRef: artifact.fullBodyRef,
            fullBodyChars: artifact.fullBodyChars,
            previewChars: artifact.previewChars,
          },
        };
      },
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-artifact",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-artifact",
        name: "web_extract",
        args: { url: "https://example.test/long-artifact" },
      },
    });

    expect(storedArtifacts).toEqual([
      expect.objectContaining({
        body: longBody,
        textPreview: expect.stringContaining("长网页正文开头"),
        bodyRef: "web-extract-body-https-example-test-long-artifact",
        fullBodyRef: "web-extract-full-body-https-example-test-long-artifact",
        sourceUrl: "https://example.test/long-artifact",
        finalUrl: "https://example.test/long-artifact",
        fullBodyChars: longBody.length,
        previewChars: expect.any(Number),
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        full_body_artifact: expect.objectContaining({
          id: "web-extract-full-body-https-example-test-long-artifact",
          kind: "web-extract-body",
          path: "/tmp/web-extract-full-body-https-example-test-long-artifact.json",
        }),
        artifacts: [
          expect.objectContaining({
            id: "web-extract-full-body-https-example-test-long-artifact",
          }),
        ],
      }),
      metadata: expect.objectContaining({
        artifactIds: ["web-extract-full-body-https-example-test-long-artifact"],
      }),
    });
    expect(result?.content).not.toContain(bodyTail);
    expect(result?.metadata?.modelVisibleContent).not.toContain(bodyTail);
  });

  it("writes long web_extract artifacts to JSON files without leaking the full body into model-visible content", async () => {
    const root = mkdtempSync(join(tmpdir(), "web-extract-artifacts-"));
    tempRoots.push(root);
    const bodyTail = "文件 artifact 尾部留证：这句只应该出现在 JSON 文件里。";
    const longBody = `文件 artifact 正文开头。${"可追溯网页正文、来源、长度、预览、引用。".repeat(160)}${bodyTail}`;
    const storeExtractArtifact = createFileConversationRuntimeWebExtractArtifactStore({
      rootDir: root,
    });
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "文件 artifact 网页",
        contentType: "text/plain",
        body: longBody,
      }),
      storeExtractArtifact,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-file-artifact",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-file-artifact",
        name: "web_extract",
        args: { url: "https://example.test/file-artifact" },
      },
    });

    const artifact = result?.output.full_body_artifact;
    expect(artifact).toMatchObject({
      id: "web-extract-full-body-https-example-test-file-artifact",
      kind: "web-extract-body",
      path: expect.stringContaining("web-extract-full-body-https-example-test-file-artifact.json"),
    });
    const path = typeof artifact?.path === "string" ? artifact.path : "";
    const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(saved).toMatchObject({
      schemaVersion: "conversation-runtime.web-extract-artifact.v1",
      body: longBody,
      sourceUrl: "https://example.test/file-artifact",
      finalUrl: "https://example.test/file-artifact",
      bodyRef: "web-extract-body-https-example-test-file-artifact",
      fullBodyRef: "web-extract-full-body-https-example-test-file-artifact",
      metadata: expect.objectContaining({
        quality: expect.objectContaining({
          status: "ok",
          publishable: true,
          reason: "readable-content",
        }),
        sourceSnapshot: expect.objectContaining({
          source_ref: "https://example.test/file-artifact",
          access_status: "available",
        }),
        extractionReport: expect.any(Object),
      }),
    });
    expect(result?.content).not.toContain(bodyTail);
    expect(result?.metadata?.modelVisibleContent).not.toContain(bodyTail);
  });

  it("reads a saved web_extract artifact by full_body_ref with an optional max char preview", async () => {
    const root = mkdtempSync(join(tmpdir(), "web-extract-artifacts-read-"));
    tempRoots.push(root);
    const bodyTail = "回读正文尾部：这句应该只在未截断回读时出现。";
    const longBody = `回读正文开头。${"完整正文、引用回读、证据留存。".repeat(120)}${bodyTail}`;
    const storeExtractArtifact = createFileConversationRuntimeWebExtractArtifactStore({
      rootDir: root,
    });
    const readExtractArtifact = createFileConversationRuntimeWebExtractArtifactReader({
      rootDir: root,
    });
    const extractors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "可回读网页",
        contentType: "text/plain",
        body: longBody,
      }),
      storeExtractArtifact,
      readExtractArtifact,
    });

    await extractors.get("web_extract")?.({
      turnId: "turn-web-extract-before-read",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-before-read",
        name: "web_extract",
        args: { url: "https://example.test/read-artifact" },
      },
    });
    const result = await extractors.get("web_extract_artifact_read")?.({
      turnId: "turn-web-extract-read",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-read",
        name: "web_extract_artifact_read",
        args: {
          full_body_ref: "web-extract-full-body-https-example-test-read-artifact",
          max_chars: 80,
        },
      },
    });

    expect(result).toMatchObject({
      callId: "call-web-extract-read",
      toolName: "web_extract_artifact_read",
      ok: true,
      output: expect.objectContaining({
        status: "success",
        full_body_ref: "web-extract-full-body-https-example-test-read-artifact",
        title: "可回读网页",
        body: expect.stringContaining("回读正文开头"),
        quality: expect.objectContaining({
          status: "ok",
          publishable: true,
        }),
        body_truncated_for_model: true,
        returned_chars: 80,
        full_body_chars: longBody.length,
      }),
    });
    expect(result?.content).toContain(
      "full_body_ref: web-extract-full-body-https-example-test-read-artifact",
    );
    expect(result?.content).toContain("body_truncated_for_model: true");
    expect(result?.content).not.toContain(bodyTail);
  });

  it("rejects low-quality anti-bot page residue instead of treating it as learned content", async () => {
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "微信公众平台",
        contentType: "text/html",
        body: "环境异常 当前环境异常，完成验证后即可继续访问。 视频 小程序 赞，轻点两下取消赞 在看，轻点两下取消在看",
      }),
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-residue",
      sessionKey: "session-1",
      call: {
        id: "call-extract-residue",
        name: "web_extract",
        args: { url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        quality: expect.objectContaining({
          status: "blocked",
          score: 0,
          publishable: false,
        }),
        external_content: expect.objectContaining({
          source_url: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          trust_boundary: "external-web",
        }),
        source_snapshot: expect.objectContaining({
          source_ref: "https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
          access_status: "source_access_limited",
        }),
        failures: expect.arrayContaining([expect.stringContaining("low-quality")]),
        next_actions: expect.arrayContaining([
          expect.stringContaining("browser_navigate profile=angel"),
        ]),
      }),
    });
    expect(result?.content).toContain("status: blocked");
    expect(result?.content).toContain("quality: blocked score=0");
    expect(result?.content).not.toContain("text_preview:");
  });

  it("rejects login and verification shells that have text but no trustworthy article body", async () => {
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => ({
        url,
        title: "登录后继续访问",
        contentType: "text/html",
        body: "登录 注册 请输入验证码 继续访问 首页 导航 推荐 分享 下载 App",
      }),
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-login-shell",
      sessionKey: "session-1",
      call: {
        id: "call-extract-login-shell",
        name: "web_extract",
        args: { url: "https://example.test/login-wall" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        quality: expect.objectContaining({
          status: "blocked",
          publishable: false,
          signals: expect.arrayContaining(["access-gate:login-or-verification"]),
        }),
        source_snapshot: expect.objectContaining({
          access_status: "source_access_limited",
        }),
        failures: expect.arrayContaining([expect.stringContaining("low-quality")]),
      }),
    });
    expect(result?.content).toContain("status: blocked");
    expect(result?.content).toContain("quality: blocked score=0");
  });

  it("returns an error observation when web_extract cannot read a page", async () => {
    const executors = createBuiltinWebToolExecutors({
      extract: async () => {
        throw new Error("HTTP 403");
      },
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-fail",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-fail",
        name: "web_extract",
        args: { url: "https://example.test/blocked" },
      },
    });

    expect(result).toMatchObject({
      callId: "call-web-extract-fail",
      toolName: "web_extract",
      ok: false,
      output: {
        status: "error",
        url: "https://example.test/blocked",
        failures: ["HTTP 403"],
      },
    });
    expect(result?.content).toContain("status: error");
    expect(result?.content).toContain("failures: HTTP 403");
    expect(result?.content).not.toContain("已学会");
  });

  it("blocks private and internal URLs before web_extract reaches a provider", async () => {
    const extractCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => {
        extractCalls.push(url);
        return {
          url,
          body: "should not be reached",
        };
      },
    });
    const execute = executors.get("web_extract");

    for (const url of [
      "http://localhost:3000/admin",
      "http://127.0.0.1:3000/admin",
      "http://10.0.0.2/admin",
      "http://172.16.0.2/admin",
      "http://192.168.1.5/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/admin",
      "http://printer.local/admin",
      "http://service.internal/admin",
      "http://router.lan/admin",
    ]) {
      const result = await execute?.({
        turnId: `turn-private-${url}`,
        sessionKey: "session-1",
        call: {
          id: `call-private-${url}`,
          name: "web_extract",
          args: { url },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        output: expect.objectContaining({
          status: "blocked",
          url,
          failures: expect.arrayContaining([
            expect.stringContaining("private or internal network"),
          ]),
          extraction_report: expect.objectContaining({
            security_gate: "blocked-private-or-internal-url",
          }),
        }),
      });
      expect(result?.content).toContain("status: blocked");
    }
    expect(extractCalls).toEqual([]);
  });

  it("blocks DNS-resolved private IPs before default web_extract fetches", async () => {
    const fetchCalls: string[] = [];
    const resolveCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      resolveExtractHost: async ({ hostname }) => {
        resolveCalls.push(hostname);
        return [{ address: "10.0.0.8", family: 4 }];
      },
      fetchImpl: (async (url: RequestInfo | URL) => {
        fetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          url: String(url),
          headers: { get: () => "text/plain" },
          text: async () => "should not be fetched",
        } as Response;
      }) as typeof fetch,
    });

    const result = await executors.get("web_extract")?.({
      turnId: "turn-web-extract-dns-private",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-dns-private",
        name: "web_extract",
        args: { url: "https://public.example.com/article" },
      },
    });

    expect(resolveCalls).toEqual(["public.example.com"]);
    expect(fetchCalls).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        failures: expect.arrayContaining([
          expect.stringContaining("resolved to a private or internal network address"),
        ]),
        extraction_report: expect.objectContaining({
          security_gate: "blocked-private-or-internal-resolved-address",
        }),
      }),
    });
  });

  it("blocks URLs that appear to contain API keys or credentials", async () => {
    const extractCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      extract: async ({ url }) => {
        extractCalls.push(url);
        return {
          url,
          body: "should not be reached",
        };
      },
    });
    const execute = executors.get("web_extract");

    for (const url of [
      "https://example.com/article?api_key=sk-test-secret-value",
      "https://example.com/article?access_token=abcdefghijklmnopqrstuvwxyz",
      "https://example.com/article?password=hunter2",
      "https://example.com/article/%73%6b-test-secret-value",
      "https://user:pass@example.com/article",
    ]) {
      const result = await execute?.({
        turnId: `turn-secret-${url}`,
        sessionKey: "session-1",
        call: {
          id: `call-secret-${url}`,
          name: "web_extract",
          args: { url },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        output: expect.objectContaining({
          status: "blocked",
          url,
          failures: expect.arrayContaining([expect.stringContaining("secret")]),
          extraction_report: expect.objectContaining({
            security_gate: "blocked-secret-bearing-url",
          }),
        }),
      });
    }
    expect(extractCalls).toEqual([]);
  });

  it("uses a timeout signal and returns structured timeout failures for default web_extract", async () => {
    const fetchCalls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-timeout",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-timeout",
        name: "web_extract",
        args: { url: "https://example.com/slow-page" },
      },
    });

    expect(fetchCalls).toEqual([
      expect.objectContaining({
        url: "https://example.com/slow-page",
        init: expect.objectContaining({
          redirect: "manual",
          signal: expect.any(AbortSignal),
        }),
      }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "error",
        failures: expect.arrayContaining([expect.stringContaining("timed out")]),
        extraction_report: expect.objectContaining({
          security_gate: "fetch-timeout",
        }),
        next_actions: expect.arrayContaining([
          expect.stringContaining("browser_navigate/browser_snapshot"),
        ]),
      }),
    });
  });

  it("does not silently follow cross-host redirects in default web_extract", async () => {
    const fetchCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) => {
        fetchCalls.push(String(url));
        return {
          ok: false,
          status: 302,
          statusText: "Found",
          url: String(url),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location" ? "https://evil.example/landing" : "text/html",
          },
          text: async () => "",
        } as Response;
      }) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-cross-host-redirect",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-cross-host-redirect",
        name: "web_extract",
        args: { url: "https://example.com/open-redirect" },
      },
    });

    expect(fetchCalls).toEqual(["https://example.com/open-redirect"]);
    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        url: "https://example.com/open-redirect",
        redirect_url: "https://evil.example/landing",
        failures: expect.arrayContaining([expect.stringContaining("cross-host redirect")]),
        extraction_report: expect.objectContaining({
          security_gate: "blocked-cross-host-redirect",
          redirect_chain: [
            {
              from: "https://example.com/open-redirect",
              to: "https://evil.example/landing",
              status: 302,
              allowed: false,
            },
          ],
        }),
      }),
    });
  });

  it("blocks same-host redirects when the redirected host resolves to a private IP", async () => {
    const fetchCalls: string[] = [];
    const resolveCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      resolveExtractHost: async ({ hostname }) => {
        resolveCalls.push(hostname);
        return hostname === "example.com"
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "192.168.1.20", family: 4 }];
      },
      fetchImpl: (async (url: RequestInfo | URL) => {
        fetchCalls.push(String(url));
        return {
          ok: false,
          status: 301,
          statusText: "Moved Permanently",
          url: String(url),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location" ? "https://www.example.com/new" : "text/html",
          },
          text: async () => "",
        } as Response;
      }) as typeof fetch,
    });

    const result = await executors.get("web_extract")?.({
      turnId: "turn-web-extract-redirect-dns-private",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-redirect-dns-private",
        name: "web_extract",
        args: { url: "https://example.com/old" },
      },
    });

    expect(resolveCalls).toEqual(["example.com", "www.example.com"]);
    expect(fetchCalls).toEqual(["https://example.com/old"]);
    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        redirect_url: "https://www.example.com/new",
        extraction_report: expect.objectContaining({
          security_gate: "blocked-private-or-internal-resolved-address",
        }),
      }),
    });
  });

  it("follows same-host redirects and records final URL evidence", async () => {
    const fetchCalls: string[] = [];
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) => {
        fetchCalls.push(String(url));
        if (String(url) === "https://example.com/old") {
          return {
            ok: false,
            status: 301,
            statusText: "Moved Permanently",
            url: String(url),
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "location" ? "https://www.example.com/new" : "text/html",
            },
            text: async () => "",
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => `
            <html>
              <head><title>Final article</title></head>
              <body><article>Readable article body with useful details for Director Angel.</article></body>
            </html>
          `,
        } as Response;
      }) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-same-host-redirect",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-same-host-redirect",
        name: "web_extract",
        args: { url: "https://example.com/old" },
      },
    });

    expect(fetchCalls).toEqual(["https://example.com/old", "https://www.example.com/new"]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        status: "success",
        url: "https://www.example.com/new",
        title: "Final article",
        external_content: expect.objectContaining({
          source_url: "https://example.com/old",
          final_url: "https://www.example.com/new",
        }),
        source_snapshot: expect.objectContaining({
          source_ref: "https://www.example.com/new",
        }),
        extraction_report: expect.objectContaining({
          provider: "default-fetch",
          redirect_chain: [
            {
              from: "https://example.com/old",
              to: "https://www.example.com/new",
              status: 301,
              allowed: true,
            },
          ],
          truncated: false,
        }),
      }),
    });
  });

  it("prefers article body over navigation, footer, comments, and sidebars", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => `
            <html>
              <head><title>Noise heavy page</title></head>
              <body>
                <nav>首页 导航 登录 注册 热榜</nav>
                <aside>相关阅读 推荐广告 下载 App</aside>
                <article>
                  <h1>镜头调度升级指南</h1>
                  <p>第一段正文讲述导演系统如何根据人物关系安排机位、景别和运动节奏，形成可以执行的分镜经验。</p>
                  <p>第二段正文继续说明提示词、场景限制、素材复用和审片反馈如何进入同一条制作链路。</p>
                  <ul><li>保留关键经验</li><li>保留执行约束</li></ul>
                </article>
                <section class="comments">评论区：沙发，点赞，转发，举报</section>
                <footer>关于我们 联系方式 备案号</footer>
              </body>
            </html>
          `,
        }) as Response) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-article-body",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-article-body",
        name: "web_extract",
        args: { url: "https://example.com/article-body" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        text_preview: expect.stringContaining("镜头调度升级指南"),
        body: expect.stringContaining("第一段正文讲述导演系统"),
        extraction_report: expect.objectContaining({
          extractor: "readability-candidate",
          candidate_count: expect.any(Number),
          noise_removed: true,
          readability_score: expect.any(Number),
        }),
      }),
    });
    expect(result?.output.body).not.toContain("首页 导航 登录");
    expect(result?.output.body).not.toContain("相关阅读 推荐广告");
    expect(result?.output.body).not.toContain("评论区");
    expect(result?.output.body).not.toContain("备案号");
    expect(result?.output.body).toContain("- 保留关键经验");
  });

  it("prefers WeChat rich media content containers when extracting articles", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html" },
          text: async () => `
            <html>
              <head><title>微信文章标题</title></head>
              <body>
                <div id="js_top_ad_area">广告和关注按钮</div>
                <div class="rich_media_content" id="js_content">
                  <h2>Seedance 分镜方法</h2>
                  <p>这篇文章正文说明如何把主题拆成镜头、动作、情绪和画面连续性要求。</p>
                  <p>经验重点是先确定叙事目的，再选择模型和生成参数，最后进入审片迭代。</p>
                </div>
                <div id="js_pc_qr_code">二维码</div>
              </body>
            </html>
          `,
        }) as Response) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-weixin-content",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-weixin-content",
        name: "web_extract",
        args: { url: "https://mp.weixin.qq.com/s/example-readable" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        body: expect.stringContaining("Seedance 分镜方法"),
        extraction_report: expect.objectContaining({
          extractor: "wechat-rich-media",
          noise_removed: true,
        }),
      }),
    });
    expect(result?.output.body).not.toContain("广告和关注按钮");
    expect(result?.output.body).not.toContain("二维码");
  });

  it("selects the densest readable content block when article tags are missing", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html" },
          text: async () => `
            <html><body>
              <div class="hero">立即注册 免费试用 下载客户端</div>
              <div class="module">短卡片 推荐 推荐 推荐</div>
              <section class="content-block">
                <h2>导演岗位经验沉淀</h2>
                <p>系统需要把用户驱动学习、定时学习、知识召回、制作执行和复盘评价放在同一条长期演进链路里。</p>
                <p>当网页没有标准 article 标签时，也应该选择这类信息密度最高、自然段最多、链接噪声最低的正文区域。</p>
              </section>
              <div class="related">猜你喜欢 热门文章 更多链接</div>
            </body></html>
          `,
        }) as Response) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-density-block",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-density-block",
        name: "web_extract",
        args: { url: "https://example.com/density" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        body: expect.stringContaining("导演岗位经验沉淀"),
        extraction_report: expect.objectContaining({
          extractor: "readability-candidate",
          candidate_count: expect.any(Number),
          readability_score: expect.any(Number),
        }),
      }),
    });
    expect(result?.output.body).not.toContain("立即注册");
    expect(result?.output.body).not.toContain("猜你喜欢");
  });

  it("blocks pure chrome residue instead of returning fake readable content", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html" },
          text: async () => `
            <html>
              <head><title>验证</title></head>
              <body>
                <nav>首页 登录 注册</nav>
                <button>赞</button><button>在看</button><button>分享</button>
                <footer>视频 小程序 轻点两下取消赞 轻点两下取消在看</footer>
              </body>
            </html>
          `,
        }) as Response) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-chrome-residue",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-chrome-residue",
        name: "web_extract",
        args: { url: "https://mp.weixin.qq.com/s/chrome-residue" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        failures: expect.arrayContaining([expect.stringContaining("low-quality")]),
        extraction_report: expect.objectContaining({
          blocked: true,
          quality_gate: "low-quality extracted content",
          extractor: expect.any(String),
        }),
      }),
    });
    expect(result?.output).not.toHaveProperty("body");
    expect(result?.content).not.toContain("text_preview:");
  });

  it("blocks dynamic social app shells instead of admitting script residue", async () => {
    const executors = createBuiltinWebToolExecutors({
      fetchImpl: (async (url: RequestInfo | URL) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          url: String(url),
          headers: { get: () => "text/html" },
          text: async () => `
            <html>
              <head><title>x.com</title></head>
              <body>
                Something went wrong, but don’t fret — let’s give it another shot.
                Some privacy related extensions may cause issues on x.com.
                a&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[a]="0583100a-cd41-43dd-8d44-06ac3498f2e2")
              </body>
            </html>
          `,
        }) as Response) as typeof fetch,
    });
    const execute = executors.get("web_extract");

    const result = await execute?.({
      turnId: "turn-web-extract-dynamic-shell",
      sessionKey: "session-1",
      call: {
        id: "call-web-extract-dynamic-shell",
        name: "web_extract",
        args: { url: "https://x.com/cellinlab/status/2054424434736349433" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      output: expect.objectContaining({
        status: "blocked",
        quality: expect.objectContaining({
          status: "blocked",
          reason: "dynamic application shell rather than source content",
          publishable: false,
          signals: expect.arrayContaining([expect.stringContaining("dynamic-shell-signals")]),
        }),
        failures: expect.arrayContaining(["dynamic application shell rather than source content"]),
      }),
    });
    expect(result?.output).not.toHaveProperty("body");
    expect(result?.content).not.toContain("_sentryDebugIds");
  });
});
