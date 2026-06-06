import { describe, expect, it } from "vitest";

import { createBuiltinBrowserToolExecutors, createBuiltinBrowserTools } from "../src/index.js";

describe("built-in browser tools", () => {
  it("defines Hermes-compatible browser tool names and schemas", () => {
    const tools = createBuiltinBrowserTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_back",
      "browser_press",
      "browser_get_images",
      "browser_console",
    ]);
    expect(tools.find((tool) => tool.name === "browser_navigate")).toMatchObject({
      readOnly: false,
      inputSchema: expect.objectContaining({
        properties: expect.objectContaining({
          profile: expect.objectContaining({
            enum: ["angel", "user", "electron"],
          }),
        }),
        required: ["url"],
        additionalProperties: false,
      }),
      metadata: expect.objectContaining({ capability: "browser.navigate" }),
    });
    expect(tools.find((tool) => tool.name === "browser_snapshot")).toMatchObject({
      readOnly: true,
      inputSchema: expect.objectContaining({
        properties: expect.objectContaining({
          mode: expect.objectContaining({
            enum: ["compact", "efficient", "readable", "interactive", "full"],
          }),
          max_chars: expect.any(Object),
          selector: expect.any(Object),
          frame: expect.any(Object),
          labels: expect.any(Object),
          urls: expect.any(Object),
          interactive: expect.any(Object),
          compact: expect.any(Object),
          depth: expect.any(Object),
          refs: expect.any(Object),
        }),
        additionalProperties: false,
      }),
      metadata: expect.objectContaining({ capability: "browser.snapshot" }),
    });
    expect(tools.find((tool) => tool.name === "browser_click")).toMatchObject({
      metadata: expect.objectContaining({
        requiresApproval: true,
        risk: "browser-mutation",
      }),
    });
    expect(tools.find((tool) => tool.name === "browser_scroll")).toMatchObject({
      readOnly: false,
      inputSchema: expect.objectContaining({
        required: ["direction"],
        additionalProperties: false,
      }),
      metadata: expect.objectContaining({ capability: "browser.scroll" }),
    });
    expect(tools.find((tool) => tool.name === "browser_get_images")).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({ capability: "browser.images" }),
    });
  });

  it("runs browser_navigate through the injected browser provider", async () => {
    const calls: unknown[] = [];
    const executors = createBuiltinBrowserToolExecutors({
      navigate: async (input) => {
        calls.push(input);
        return {
          success: true,
          url: input.url,
          title: `Title for ${input.sessionKey}`,
          snapshot: "[ref=@e1] link Example",
          element_count: 1,
        };
      },
    });
    const execute = executors.get("browser_navigate");

    const result = await execute?.({
      turnId: "turn-browser",
      sessionKey: "session-1",
      call: {
        id: "call-nav",
        name: "browser_navigate",
        args: { url: "https://example.test" },
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://example.test",
      }),
    ]);
    expect(result).toMatchObject({
      callId: "call-nav",
      toolName: "browser_navigate",
      ok: true,
      output: {
        status: "success",
        url: "https://example.test",
        title: "Title for session-1",
        element_count: 1,
      },
    });
    expect(result?.content).toContain("snapshot_preview:");
    expect(result?.content).toContain("[ref=@e1] link Example");
  });

  it("passes explicit existing Chrome profile requests to the browser provider", async () => {
    const calls: unknown[] = [];
    const execute = createBuiltinBrowserToolExecutors({
      navigate: async (input) => {
        calls.push(input);
        return {
          success: true,
          url: input.url,
          title: "Live Chrome",
          snapshot: "Chrome page",
          metadata: {
            provider_id: "chrome-existing-session",
            profile: input.profile,
            existing_session: true,
          },
        };
      },
    }).get("browser_navigate");

    const result = await execute?.({
      turnId: "turn-browser",
      sessionKey: "session-1",
      call: {
        id: "call-nav-chrome",
        name: "browser_navigate",
        args: { url: "https://example.test", profile: "user" },
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://example.test",
        profile: "user",
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        provider_id: "chrome-existing-session",
        profile: "user",
        existing_session: true,
      }),
    });
  });

  it("passes explicit Angel managed Chrome profile requests to the browser provider", async () => {
    const calls: unknown[] = [];
    const execute = createBuiltinBrowserToolExecutors({
      navigate: async (input) => {
        calls.push(input);
        return {
          success: true,
          url: input.url,
          title: "Angel Chrome",
          snapshot: "Angel managed Chrome page",
          metadata: {
            provider_id: "angel-managed-chrome",
            profile: input.profile,
            managed_profile: true,
          },
        };
      },
    }).get("browser_navigate");

    const result = await execute?.({
      turnId: "turn-browser",
      sessionKey: "session-1",
      call: {
        id: "call-nav-angel",
        name: "browser_navigate",
        args: { url: "https://x.com/search?q=seedance", profile: "angel" },
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://x.com/search?q=seedance",
        profile: "angel",
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        provider_id: "angel-managed-chrome",
        profile: "angel",
        managed_profile: true,
      }),
    });
  });

  it("treats empty http browser snapshots as failed evidence", async () => {
    const execute = createBuiltinBrowserToolExecutors({
      snapshot: async () => ({
        success: true,
        url: "https://x.com/openai/status/1234567890",
        title: "",
        text: "",
        elements: [],
        element_count: 0,
      }),
    }).get("browser_snapshot");

    const result = await execute?.({
      turnId: "turn-empty-snapshot",
      sessionKey: "session-1",
      call: {
        id: "call-empty-snapshot",
        name: "browser_snapshot",
        args: { full: true },
      },
    });

    expect(result).toMatchObject({
      callId: "call-empty-snapshot",
      toolName: "browser_snapshot",
      ok: false,
      output: {
        status: "error",
        url: "https://x.com/openai/status/1234567890",
        element_count: 0,
        failures: [
          "Browser snapshot returned no readable text and no interactive elements for a http(s) page.",
        ],
      },
    });
    expect(result?.content).toContain("status: error");
    expect(result?.content).not.toContain("admit useful text");
  });

  it("returns web-extract-compatible source evidence on successful browser_snapshot", async () => {
    const articleText = "浏览器已经读取到文章正文，可作为文本证据进入学习候选。";
    const execute = createBuiltinBrowserToolExecutors({
      snapshot: async () => ({
        success: true,
        url: "https://example.test/article",
        title: "Browser Article",
        text: articleText,
        elements: [],
        element_count: 0,
      }),
    }).get("browser_snapshot");

    const result = await execute?.({
      turnId: "turn-browser-source-evidence",
      sessionKey: "session-1",
      call: {
        id: "call-browser-source-evidence",
        name: "browser_snapshot",
        args: { full: true },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        source_snapshot: expect.objectContaining({
          id: "browser-snapshot-https-example-test-article",
          source_kind: "url",
          source_ref: "https://example.test/article",
          access_status: "available",
          readable_chars: articleText.length,
        }),
        external_content: expect.objectContaining({
          source_url: "https://example.test/article",
          final_url: "https://example.test/article",
          title: "Browser Article",
          content_type: "text/plain",
          trust_boundary: "external-browser",
        }),
        evidence_disclosure: expect.objectContaining({
          schemaVersion: "conversation-runtime.browser-snapshot-evidence-disclosure.v1",
          url: "https://example.test/article",
          title: "Browser Article",
          full_body_chars: articleText.length,
          media_count: 0,
          text_read: true,
        }),
      }),
      metadata: expect.objectContaining({
        sourceSnapshot: expect.objectContaining({
          id: "browser-snapshot-https-example-test-article",
        }),
        evidenceDisclosure: expect.objectContaining({
          url: "https://example.test/article",
        }),
      }),
    });
    expect(result?.content).toContain(
      "source_snapshot: browser-snapshot-https-example-test-article",
    );
    expect(result?.content).toContain("evidence_disclosure:");
  });

  it("returns an explicit unavailable observation when no browser provider exists", async () => {
    const execute = createBuiltinBrowserToolExecutors().get("browser_snapshot");

    const result = await execute?.({
      turnId: "turn-browser-unavailable",
      sessionKey: "session-1",
      call: {
        id: "call-snapshot",
        name: "browser_snapshot",
        args: {},
      },
    });

    expect(result).toMatchObject({
      callId: "call-snapshot",
      toolName: "browser_snapshot",
      ok: false,
      output: {
        status: "error",
        failures: ["browser provider unavailable"],
      },
    });
    expect(result?.content).toContain("Browser tool provider is unavailable");
  });

  it("normalizes bare element refs for browser_type", async () => {
    const calls: string[] = [];
    const execute = createBuiltinBrowserToolExecutors({
      type: async ({ ref, text }) => {
        calls.push(`${ref}:${text}`);
        return {
          success: true,
          element: ref,
          typed: text,
        };
      },
    }).get("browser_type");

    const result = await execute?.({
      turnId: "turn-browser-type",
      sessionKey: "session-1",
      call: {
        id: "call-type",
        name: "browser_type",
        args: { ref: "e3", text: "hello" },
      },
    });

    expect(calls).toEqual(["@e3:hello"]);
    expect(result?.output).toMatchObject({
      status: "success",
      element: "@e3",
      typed_chars: 5,
    });
  });

  it("passes a structured snapshot plan to the browser provider and returns it in the observation", async () => {
    const calls: unknown[] = [];
    const execute = createBuiltinBrowserToolExecutors({
      snapshot: async (input) => {
        calls.push(input);
        return {
          success: true,
          url: "https://x.com/openai/status/1234567890",
          title: "OpenAI on X",
          snapshot: "Post text\n[ref=@e1] link OpenAI",
          elements: [{ ref: "@e1", role: "link", name: "OpenAI" }],
          element_count: 1,
        };
      },
    }).get("browser_snapshot");

    const result = await execute?.({
      turnId: "turn-browser-snapshot-plan",
      sessionKey: "session-1",
      call: {
        id: "call-snapshot-plan",
        name: "browser_snapshot",
        args: {
          full: false,
          mode: "efficient",
          max_chars: 12_000,
          selector: "article",
          frame: "main",
          labels: true,
          urls: true,
          interactive: true,
          compact: true,
          depth: 3,
          refs: true,
        },
      },
      metadata: {
        userText: "读取这个帖子",
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        full: false,
        mode: "efficient",
        maxChars: 12_000,
        selector: "article",
        frame: "main",
        labels: true,
        urls: true,
        interactive: true,
        compact: true,
        depth: 3,
        refs: true,
        userTask: "读取这个帖子",
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        snapshot_plan: {
          full: false,
          mode: "efficient",
          max_chars: 12_000,
          selector: "article",
          frame: "main",
          labels: true,
          urls: true,
          interactive: true,
          compact: true,
          depth: 3,
          refs: true,
        },
      }),
    });
    expect(result?.content).toContain("snapshot_plan:");
    expect(result?.content).toContain("mode=efficient");
    expect(result?.content).toContain("max_chars=12000");
  });

  it("honors explicit snapshot max_chars instead of always cutting at 8000 characters", async () => {
    const longArticle = `六宫格故事板正文开头。${"这一段解释时间、场景、运镜和情绪。".repeat(
      520,
    )}正文尾部：附录B最短版提示词。`;
    const execute = createBuiltinBrowserToolExecutors({
      snapshot: async () => ({
        success: true,
        url: "https://x.com/ponyodong/status/2055150198989746559",
        title: "波妞PONYO：六宫格故事板",
        snapshot: longArticle,
        elements: [],
        element_count: 0,
      }),
    }).get("browser_snapshot");

    const result = await execute?.({
      turnId: "turn-browser-snapshot-long",
      sessionKey: "session-1",
      call: {
        id: "call-snapshot-long",
        name: "browser_snapshot",
        args: {
          full: true,
          mode: "readable",
          max_chars: 16_000,
          urls: true,
          compact: true,
          refs: true,
        },
      },
    });

    expect(result?.output).toMatchObject({
      status: "success",
      text: expect.stringContaining("正文尾部：附录B最短版提示词"),
    });
    expect(result?.content).toContain("正文尾部：附录B最短版提示词");
    expect(result?.content).not.toContain("[truncated]");
  });

  it("runs advanced browser tools through the injected browser provider", async () => {
    const calls: string[] = [];
    const executors = createBuiltinBrowserToolExecutors({
      scroll: async ({ direction, pages }) => {
        calls.push(`scroll:${direction}:${pages}`);
        return {
          success: true,
          direction,
          pages,
          snapshot: "after scroll",
          element_count: 2,
        };
      },
      back: async () => {
        calls.push("back");
        return {
          success: true,
          url: "https://example.test/previous",
          title: "Previous",
          snapshot: "previous page",
          element_count: 1,
        };
      },
      press: async ({ key }) => {
        calls.push(`press:${key}`);
        return {
          success: true,
          key,
          snapshot: "after key",
          element_count: 3,
        };
      },
      getImages: async () => {
        calls.push("images");
        return {
          success: true,
          images: [{ src: "https://example.test/a.png", alt: "A", width: 100, height: 80 }],
          image_count: 1,
        };
      },
      console: async ({ expression }) => {
        calls.push(`console:${expression}`);
        return {
          success: true,
          result: "ok",
          messages: [{ level: "log", text: "ready" }],
        };
      },
    });

    const scroll = await executors.get("browser_scroll")?.({
      turnId: "turn-browser-advanced",
      sessionKey: "session-1",
      call: {
        id: "call-scroll",
        name: "browser_scroll",
        args: { direction: "down", pages: 2 },
      },
    });
    const back = await executors.get("browser_back")?.({
      turnId: "turn-browser-advanced",
      sessionKey: "session-1",
      call: { id: "call-back", name: "browser_back", args: {} },
    });
    const press = await executors.get("browser_press")?.({
      turnId: "turn-browser-advanced",
      sessionKey: "session-1",
      call: { id: "call-press", name: "browser_press", args: { key: "Enter" } },
    });
    const images = await executors.get("browser_get_images")?.({
      turnId: "turn-browser-advanced",
      sessionKey: "session-1",
      call: { id: "call-images", name: "browser_get_images", args: {} },
    });
    const consoleResult = await executors.get("browser_console")?.({
      turnId: "turn-browser-advanced",
      sessionKey: "session-1",
      call: {
        id: "call-console",
        name: "browser_console",
        args: { expression: "document.readyState" },
      },
    });

    expect(calls).toEqual([
      "scroll:down:2",
      "back",
      "press:Enter",
      "images",
      "console:document.readyState",
    ]);
    expect(scroll?.content).toContain("direction: down");
    expect(back?.content).toContain("url: https://example.test/previous");
    expect(press?.content).toContain("key: Enter");
    expect(images?.content).toContain("image_count: 1");
    expect(consoleResult?.content).toContain("result: ok");
  });

  it("projects browser image lists into non-publishable listed-only media evidence", async () => {
    const execute = createBuiltinBrowserToolExecutors({
      getImages: async () => ({
        success: true,
        images: [
          {
            src: "https://example.test/a.png",
            alt: "A",
            width: 100,
            height: 80,
            metadata: { source: "img" },
          },
        ],
        image_count: 1,
        metadata: { page_url: "https://example.test/page" },
      }),
    }).get("browser_get_images");

    const result = await execute?.({
      turnId: "turn-browser-images-evidence",
      sessionKey: "session-1",
      call: { id: "call-images-evidence", name: "browser_get_images", args: {} },
    });

    expect(result).toMatchObject({
      ok: true,
      output: expect.objectContaining({
        image_count: 1,
        media_evidence: [
          expect.objectContaining({
            id: "media-evidence-call-images-evidence-1",
            sourceRef: "https://example.test/a.png",
            status: "listed_only",
            realVisualUnderstanding: false,
            publishable: false,
            metadata: expect.objectContaining({
              width: 100,
              height: 80,
              pageUrl: "https://example.test/page",
            }),
          }),
        ],
        mediaEvidenceRefs: [
          expect.objectContaining({
            id: "media-evidence-call-images-evidence-1",
            status: "listed_only",
            realVisualUnderstanding: false,
          }),
        ],
        learning_gate: expect.objectContaining({
          publishable: false,
          reason: "listed_images_are_not_visual_understanding",
          mediaAuthorizationRequest: expect.objectContaining({
            required: true,
            assetCount: 1,
            imageCount: 1,
            defaultMode: "media_inventory",
            recommendedMode: "low_cost",
            estimatedCostTier: "low",
          }),
        }),
      }),
    });
    expect(result?.metadata).toMatchObject({
      mediaEvidenceRefs: [
        expect.objectContaining({
          id: "media-evidence-call-images-evidence-1",
          status: "listed_only",
          realVisualUnderstanding: false,
        }),
      ],
    });
    expect(result?.content).toContain("media_evidence:");
    expect(result?.content).toContain("media_authorization:");
    expect(result?.content).toContain("listed_only");
    expect(result?.content).toContain("not visual understanding");
  });
});
