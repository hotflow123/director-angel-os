import { describe, expect, it, vi } from "vitest";

import {
  createDesktopBrowserLearningFetchServer,
  createDesktopBrowserLearningFetchText,
  shouldUseBrowserLearningWindow,
} from "./desktop-browser-fetch.js";

describe("desktop browser learning fetch", () => {
  it("keeps ordinary readable pages on the normal fetch path", async () => {
    const BrowserWindow = vi.fn();
    const fetchText = createDesktopBrowserLearningFetchText({
      BrowserWindow,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://example.com/guide",
        headers: new Map([["content-type", "text/html; charset=utf-8"]]),
        text: async () =>
          "<html><title>Guide</title><body><main>Readable guide content for Director Angel learning.</main></body></html>",
      }),
    });

    const result = await fetchText("https://example.com/guide");

    expect(result).toMatchObject({
      url: "https://example.com/guide",
      contentType: "text/html; charset=utf-8",
    });
    expect(result.body).toContain("Readable guide content");
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("fails closed instead of opening an Electron learning window for login shells", async () => {
    const BrowserWindow = vi.fn();
    const fetchText = createDesktopBrowserLearningFetchText({
      BrowserWindow,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://accounts.feishu.cn/accounts/page/login",
        headers: new Map([["content-type", "text/html; charset=utf-8"]]),
        text: async () => "<html><body><script>window.__login = true</script></body></html>",
      }),
      allowElectronWindow: true,
      visible: true,
    });

    await expect(fetchText("https://bcn5ot9wwnew.feishu.cn/wiki/doc")).rejects.toThrow(
      /禁止用 Electron 学习窗口直接打开网页/u,
    );
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("fails closed instead of opening an Electron learning window when standard fetch cannot read trusted text", async () => {
    const BrowserWindow = vi.fn();
    const fetchText = createDesktopBrowserLearningFetchText({
      BrowserWindow,
      fetchImpl: async () => {
        throw new Error("network blocked");
      },
      allowElectronWindow: true,
    });

    await expect(fetchText("https://x.com/example/status/1")).rejects.toThrow(
      /standard-fetch-unavailable/u,
    );
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("classifies auth redirects and script-only shells as browser-learning pages", () => {
    expect(
      shouldUseBrowserLearningWindow({
        url: "https://accounts.feishu.cn/accounts/page/login",
        status: 200,
        contentType: "text/html",
        body: "<html><body></body></html>",
      }),
    ).toBe(true);
    expect(
      shouldUseBrowserLearningWindow({
        url: "https://example.com/app",
        status: 200,
        contentType: "text/html",
        body: "<html><body><script>renderApp()</script></body></html>",
      }),
    ).toBe(true);
    expect(
      shouldUseBrowserLearningWindow({
        url: "https://example.com/readable",
        status: 200,
        contentType: "text/html",
        body: "<html><body><main>Readable guide content for Director Angel learning.</main></body></html>",
      }),
    ).toBe(false);
  });

  it("serves the desktop extractor over a localhost POST bridge without creating browser windows", async () => {
    const fetchText = vi.fn(async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      body: "受控读取链路抓到的正文",
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind: "opencli-capture",
        url,
        title: "受控读取",
      },
    }));
    const server = createDesktopBrowserLearningFetchServer({ fetchText });
    await server.start({ port: 0 });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://mp.weixin.qq.com/s/example" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(fetchText).toHaveBeenCalledWith("https://mp.weixin.qq.com/s/example");
      expect(payload).toMatchObject({
        url: "https://mp.weixin.qq.com/s/example",
        contentType: "text/plain; charset=utf-8",
        body: "受控读取链路抓到的正文",
        structuredContent: {
          schemaVersion: "director.source.snapshot.v1",
          kind: "opencli-capture",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("returns an extractor failure instead of falling back to an Electron window", async () => {
    const BrowserWindow = vi.fn();
    const fetchText = createDesktopBrowserLearningFetchText({
      BrowserWindow,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://accounts.example.test/login",
        headers: new Map([["content-type", "text/html; charset=utf-8"]]),
        text: async () => "<html><body>Login required</body></html>",
      }),
      allowElectronWindow: true,
    });
    const server = createDesktopBrowserLearningFetchServer({ fetchText });
    await server.start({ port: 0 });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.test/private" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(502);
      expect(payload).toMatchObject({
        error: "extract-failed",
        message: expect.stringContaining("禁止用 Electron 学习窗口直接打开网页"),
      });
      expect(BrowserWindow).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("times out hung extractor bridge requests", async () => {
    const fetchText = vi.fn(
      () =>
        new Promise(() => {
          // Simulate a controlled extractor that never reaches readable content.
        }),
    );
    const server = createDesktopBrowserLearningFetchServer({
      fetchText,
      requestTimeoutMs: 20,
    });
    await server.start({ port: 0 });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://mp.weixin.qq.com/s/hung" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(504);
      expect(payload).toMatchObject({
        error: "extract-failed",
        message: expect.stringContaining("timed out"),
      });
      expect(fetchText).toHaveBeenCalledWith("https://mp.weixin.qq.com/s/hung");
    } finally {
      await server.close();
    }
  });

  it("rejects non-extract routes and invalid extractor bridge payloads", async () => {
    const fetchText = vi.fn();
    const server = createDesktopBrowserLearningFetchServer({ fetchText });
    await server.start({ port: 0 });

    try {
      const getResponse = await fetch(server.url);
      const invalidResponse = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "file:///tmp/secret" }),
      });
      const missingResponse = await fetch(new URL("/missing", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });

      expect(getResponse.status).toBe(405);
      expect(invalidResponse.status).toBe(400);
      expect(missingResponse.status).toBe(404);
      expect(fetchText).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
