import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  createChromeCdpBrowserProvider,
  createDesktopBrowserToolServer,
  createDesktopBrowserToolService,
  launchAngelManagedChrome,
} from "./desktop-browser-tool-service.js";

describe("desktop browser tool service", () => {
  it("routes default navigation to Angel Chrome instead of opening Electron", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const angelChromeProvider = createFakeProfileProvider({
      providerId: "angel-managed-chrome",
      profile: "angel",
      title: "Angel Chrome",
      text: "Angel 独立浏览器正文",
    });
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider,
    });

    const result = await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
    });

    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(angelChromeProvider.navigate).toHaveBeenCalledWith({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
    });
    expect(result).toMatchObject({
      success: true,
      title: "Angel Chrome",
      metadata: expect.objectContaining({
        provider_id: "angel-managed-chrome",
        profile: "angel",
      }),
    });
  });

  it("blocks explicit Electron profile navigation", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
    });

    const result = await service.navigate({
      turnId: "turn-electron",
      sessionKey: "desktop:electron",
      url: "https://example.test/page",
      profile: "electron",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("禁止用 Electron 直接打开网页"),
      metadata: expect.objectContaining({
        provider_status: "blocked",
        reason: "electron-profile-blocked",
      }),
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("can navigate with Electron only when a test injects the legacy profile shim", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider: createLegacyElectronProfileShim(BrowserWindow, {
        visible: false,
        operationTimeoutMs: 500,
      }),
    });

    const result = await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
      profile: "angel",
    });

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Director Angel 浏览器工具",
        show: false,
        skipTaskbar: true,
        webPreferences: expect.objectContaining({
          partition: "persist:director-angel-browser-tools",
        }),
      }),
    );
    expect(BrowserWindow.mock.results[0].value.directorAngelWindowRole).toBe(
      "director-angel-browser-tool",
    );
    expect(result).toMatchObject({
      success: true,
      url: "https://example.test/page",
      title: "Example Page",
      element_count: 2,
    });
    expect(result.snapshot).toContain("[@e1] link Docs");
  });

  it("fails closed when a real Chrome existing-session profile is requested", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
    });

    const result = await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
      profile: "user",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("真实 Google Chrome"),
      metadata: expect.objectContaining({
        provider_id: "chrome-existing-session",
        provider_status: "unavailable",
        requested_profile: "user",
        required_provider_id: "chrome-existing-session",
      }),
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("does not crash startup when the runtime lacks a global WebSocket", async () => {
    vi.stubGlobal("WebSocket", undefined);
    try {
      const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
      const service = createDesktopBrowserToolService({
        BrowserWindow,
        visible: false,
        operationTimeoutMs: 500,
        chromeExistingSessionProvider: createChromeCdpBrowserProvider({
          cdpUrl: "http://127.0.0.1:9222",
          operationTimeoutMs: 500,
          maxSnapshotChars: 8000,
          sessionTtlMs: 60_000,
          nowMs: () => Date.now(),
          fetchImpl: async () => ({
            ok: true,
            json: async () => [
              {
                id: "page-1",
                type: "page",
                webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/page-1",
              },
            ],
          }),
        }),
      });

      const result = await service.navigate({
        turnId: "turn-1",
        sessionKey: "desktop:workbench",
        url: "https://example.test/page",
        profile: "user",
      });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("真实 Google Chrome"),
        metadata: expect.objectContaining({
          provider_id: "chrome-existing-session",
          detail: "WebSocket is unavailable for Chrome CDP.",
        }),
      });
      expect(BrowserWindow).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses Chrome CDP for the user profile when an existing-session provider is connected", async () => {
    const cdp = createFakeChromeCdp();
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      chromeExistingSessionProvider: cdp.provider,
    });

    const result = await service.navigate({
      turnId: "turn-chrome",
      sessionKey: "desktop:chrome",
      url: "https://mp.weixin.qq.com/s/article",
      profile: "user",
    });
    const snapshot = await service.snapshot({
      turnId: "turn-chrome",
      sessionKey: "desktop:chrome",
      full: true,
    });

    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      url: "https://mp.weixin.qq.com/s/article",
      title: "Chrome Article",
      metadata: expect.objectContaining({
        provider_id: "chrome-existing-session",
        profile: "user",
      }),
    });
    expect(result.snapshot).toContain("[@e1] link 继续阅读");
    expect(snapshot).toMatchObject({
      success: true,
      title: "Chrome Article",
      text: expect.stringContaining("真实 Chrome 登录态正文"),
    });
    expect(cdp.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(["Page.navigate", "Runtime.evaluate"]),
    );
    expect(service.status()).toMatchObject({
      providers: {
        user: expect.objectContaining({
          provider_id: "chrome-existing-session",
          session_count: 1,
        }),
      },
      sessions: [expect.objectContaining({ provider_id: "chrome-existing-session" })],
    });
  });

  it("does not auto-launch a managed Chrome from browser_navigate", async () => {
    const cdp = createFakeChromeCdp({ requireLaunch: true });
    const launch = vi.fn(async () => {
      cdp.markLaunched();
      return {
        pid: 42,
        cdpUrl: "http://127.0.0.1:9222",
      };
    });
    const provider = createChromeCdpBrowserProvider({
      cdpUrl: "http://127.0.0.1:9222",
      operationTimeoutMs: 500,
      maxSnapshotChars: 8000,
      sessionTtlMs: 60_000,
      nowMs: () => Date.now(),
      fetchImpl: cdp.fetchImpl,
      WebSocketImpl: cdp.WebSocketImpl,
      launch,
      launchOnConnect: true,
    });

    const result = await provider.navigate({
      turnId: "turn-no-auto-launch",
      sessionKey: "desktop:chrome-launch",
      url: "https://mp.weixin.qq.com/s/article",
    });

    expect(launch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      metadata: expect.objectContaining({
        provider_status: "unavailable",
      }),
    });
  });

  it("does not launch Angel Chrome from browser_connect unless the operator explicitly allows it", async () => {
    const cdp = createFakeChromeCdp({ requireLaunch: true, failTargetListCount: 2 });
    const launch = vi.fn(async () => {
      cdp.markLaunched();
      return {
        pid: 42,
        cdpUrl: "http://127.0.0.1:9222",
      };
    });
    const provider = createChromeCdpBrowserProvider({
      cdpUrl: "http://127.0.0.1:9222",
      operationTimeoutMs: 500,
      maxSnapshotChars: 8000,
      sessionTtlMs: 60_000,
      nowMs: () => Date.now(),
      fetchImpl: cdp.fetchImpl,
      WebSocketImpl: cdp.WebSocketImpl,
      launch,
      launchOnConnect: true,
      managedLaunchAllowed: false,
    });

    const connected = await provider.connect();

    expect(launch).not.toHaveBeenCalled();
    expect(connected).toMatchObject({
      success: false,
      metadata: expect.objectContaining({
        provider_status: "unavailable",
      }),
    });
  });

  it("blocks Angel Chrome launch by default so no blank browser steals the desktop", async () => {
    const spawnImpl = vi.fn(() => ({
      pid: 42,
      unref: vi.fn(),
    }));

    const result = await launchAngelManagedChrome({
      cdpUrl: "http://127.0.0.1:9223",
      userDataDir: "/tmp/director-angel-test-chrome-profile",
      spawnImpl,
    });

    expect(result).toMatchObject({
      launched: false,
      status: "launch-blocked",
      profile: "angel",
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("can launch Angel Chrome only when the operator explicitly allows managed launch", async () => {
    const spawnImpl = vi.fn(() => ({
      pid: 42,
      unref: vi.fn(),
    }));

    const result = await launchAngelManagedChrome({
      cdpUrl: "http://127.0.0.1:9223",
      userDataDir: "/tmp/director-angel-test-chrome-profile",
      spawnImpl,
      allowManagedLaunch: true,
    });

    expect(result).toMatchObject({
      launched: true,
      status: "launch-requested",
      profile: "angel",
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        "--remote-debugging-port=9223",
        "--window-position=-32000,-32000",
        "--start-minimized",
        "about:blank",
      ]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      }),
    );
  });

  it("rejects unsupported browser profiles instead of falling back to Electron or Chrome", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const chromeExistingSessionProvider = {
      navigate: vi.fn(),
      status: vi.fn(() => ({
        success: true,
        connected: true,
        provider_id: "chrome-existing-session",
        status: "configured",
        session_count: 0,
      })),
      cleanupExpired: vi.fn(),
    };
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      chromeExistingSessionProvider,
    });

    const result = await service.navigate({
      turnId: "turn-profile",
      sessionKey: "desktop:profile",
      url: "https://example.test/page",
      profile: "personal",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unsupported browser profile"),
      metadata: expect.objectContaining({
        requested_profile: "personal",
        supported_profiles: ["angel", "user"],
      }),
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(chromeExistingSessionProvider.navigate).not.toHaveBeenCalled();
  });

  it("uses Angel managed Chrome for the angel profile without touching Electron or user Chrome", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const angelChromeProvider = createFakeProfileProvider({
      providerId: "angel-managed-chrome",
      profile: "angel",
      title: "Angel Chrome",
      text: "Angel 独立浏览器正文",
    });
    const chromeExistingSessionProvider = createFakeProfileProvider({
      providerId: "chrome-existing-session",
      profile: "user",
      title: "User Chrome",
      text: "User Chrome text",
    });
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider,
      chromeExistingSessionProvider,
    });

    const result = await service.navigate({
      turnId: "turn-angel",
      sessionKey: "desktop:angel",
      url: "https://x.com/search?q=seedance",
      profile: "angel",
    });
    const snapshot = await service.snapshot({
      turnId: "turn-angel",
      sessionKey: "desktop:angel",
      full: true,
    });

    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(angelChromeProvider.navigate).toHaveBeenCalledWith({
      turnId: "turn-angel",
      sessionKey: "desktop:angel",
      url: "https://x.com/search?q=seedance",
    });
    expect(chromeExistingSessionProvider.navigate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      title: "Angel Chrome",
      metadata: expect.objectContaining({
        provider_id: "angel-managed-chrome",
        profile: "angel",
      }),
    });
    expect(snapshot).toMatchObject({
      success: true,
      text: "Angel 独立浏览器正文",
      metadata: expect.objectContaining({
        provider_id: "angel-managed-chrome",
        profile: "angel",
      }),
    });
    expect(service.status()).toMatchObject({
      supported_profiles: ["angel", "user"],
      providers: {
        angel: expect.objectContaining({
          provider_id: "angel-managed-chrome",
          profile: "angel",
        }),
        user: expect.objectContaining({
          provider_id: "chrome-existing-session",
          profile: "user",
        }),
      },
    });
  });

  it("reports Chrome CDP capability and health diagnostics after connecting", async () => {
    const cdp = createFakeChromeCdp();

    const connected = await cdp.provider.connect();
    const status = cdp.provider.status();

    expect(connected).toMatchObject({
      success: true,
      connected: true,
      provider_id: "chrome-existing-session",
      capabilities: expect.objectContaining({
        mode: "local-existing-session",
        uses_chrome_cdp: true,
        supports_reset: false,
        supports_persistent_profile_mutation: false,
      }),
      cdp_control: expect.objectContaining({
        cdp_http: true,
        cdp_ready: true,
        target_count: 1,
        browser: "Chrome/126",
      }),
      security: expect.objectContaining({
        cdp_url_policy: "loopback-control-plane",
        warnings: [],
      }),
    });
    expect(status).toMatchObject({
      status: "connected",
      capabilities: expect.objectContaining({
        mode: "local-existing-session",
      }),
      cdp_control: expect.objectContaining({
        cdp_http: true,
        cdp_ready: true,
        target_count: 1,
      }),
      security: expect.objectContaining({
        cdp_url_policy: "loopback-control-plane",
      }),
    });
  });

  it("blocks remote Chrome CDP endpoints unless explicitly allowed", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));
    const provider = createChromeCdpBrowserProvider({
      cdpUrl: "http://203.0.113.10:9222",
      operationTimeoutMs: 500,
      maxSnapshotChars: 8000,
      sessionTtlMs: 60_000,
      nowMs: () => Date.now(),
      fetchImpl,
    });

    const result = await provider.connect();

    expect(result).toMatchObject({
      success: false,
      metadata: expect.objectContaining({
        provider_id: "chrome-existing-session",
        cdp_control: expect.objectContaining({
          cdp_ready: false,
        }),
        security: expect.objectContaining({
          cdp_url_policy: "remote-cdp-blocked",
        }),
      }),
    });
    expect(result.metadata.security.warnings.join("\n")).toContain("远程 Chrome CDP");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clicks only refs from the latest snapshot", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider: createLegacyElectronProfileShim(BrowserWindow, {
        visible: false,
        operationTimeoutMs: 500,
      }),
    });

    await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
      profile: "angel",
    });
    const result = await service.click({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      ref: "@e1",
    });

    expect(result).toMatchObject({
      success: true,
      clicked: "@e1",
    });
    expect(BrowserWindow.mock.results[0].value.clickedRefs).toEqual(["@e1"]);
  });

  it("rejects stale or unknown refs without executing page actions", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider: createLegacyElectronProfileShim(BrowserWindow, {
        visible: false,
        operationTimeoutMs: 500,
      }),
    });

    await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
      profile: "angel",
    });
    const result = await service.type({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      ref: "@e99",
      text: "hello",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unknown browser ref @e99"),
    });
    expect(BrowserWindow.mock.results[0].value.typed).toEqual([]);
  });

  it("executes advanced browser actions against the active desktop window", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider: createLegacyElectronProfileShim(BrowserWindow, {
        visible: false,
        operationTimeoutMs: 500,
      }),
    });

    await service.navigate({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      url: "https://example.test/page",
      profile: "angel",
    });
    const scroll = await service.scroll({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      direction: "down",
      pages: 2,
    });
    const press = await service.press({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      key: "Enter",
    });
    const images = await service.getImages({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
    });
    const consoleResult = await service.console({
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      expression: "document.title",
      clear: true,
    });

    const window = BrowserWindow.mock.results[0].value;
    expect(scroll).toMatchObject({ success: true, direction: "down", pages: 2 });
    expect(press).toMatchObject({ success: true, key: "Enter" });
    expect(images).toMatchObject({
      success: true,
      image_count: 1,
      images: [expect.objectContaining({ src: "https://example.test/a.png" })],
    });
    expect(consoleResult).toMatchObject({
      success: true,
      result: "Example Page",
      cleared: true,
    });
    expect(window.sentInputEvents).toEqual([
      { type: "keyDown", keyCode: "Enter" },
      { type: "keyUp", keyCode: "Enter" },
    ]);
    expect(window.executedScripts.some((script) => script.includes("window.scrollBy"))).toBe(true);
  });

  it("serves browser tool calls over a loopback control endpoint for channel adapters", async () => {
    const browserToolService = {
      navigate: vi.fn(async (input) => ({
        success: true,
        url: input.url,
        title: "Shared Browser",
        snapshot: "[@e1] heading Shared Browser",
        element_count: 1,
        metadata: {
          sessionKey: input.sessionKey,
        },
      })),
    };
    const server = createDesktopBrowserToolServer({
      browserToolService,
      requestTimeoutMs: 500,
    });

    const endpoint = await server.start({ port: 0 });
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "browser_navigate",
          turnId: "turn-1",
          sessionKey: "weixin:friend",
          args: { url: "https://example.test/shared" },
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(browserToolService.navigate).toHaveBeenCalledWith({
        turnId: "turn-1",
        sessionKey: "weixin:friend",
        url: "https://example.test/shared",
      });
      expect(body).toMatchObject({
        success: true,
        url: "https://example.test/shared",
        title: "Shared Browser",
        metadata: { sessionKey: "weixin:friend" },
      });
    } finally {
      await server.close();
    }
  });

  it("cleans up the session when a loopback browser tool request times out", async () => {
    const browserToolService = {
      navigate: vi.fn(() => new Promise(() => {})),
      cleanup: vi.fn(() => ({
        success: true,
        closed_session_count: 1,
        session_count: 0,
      })),
    };
    const server = createDesktopBrowserToolServer({
      browserToolService,
      requestTimeoutMs: 10,
    });

    const endpoint = await server.start({ port: 0 });
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "browser_navigate",
          turnId: "turn-slow",
          sessionKey: "weixin:slow-browser",
          args: { url: "https://example.test/slow" },
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toMatchObject({
        success: false,
        error: "tool-failed",
        cleanup: expect.objectContaining({
          success: true,
          closed_session_count: 1,
        }),
      });
      expect(body.message).toContain("timed out");
      expect(browserToolService.cleanup).toHaveBeenCalledWith({
        sessionKey: "weixin:slow-browser",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid browser tool control requests before they reach Electron", async () => {
    const browserToolService = {
      navigate: vi.fn(),
    };
    const server = createDesktopBrowserToolServer({ browserToolService });

    const endpoint = await server.start({ port: 0 });
    try {
      const wrongMethod = await fetch(endpoint.url, { method: "GET" });
      const unknownTool = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "browser_secret",
          turnId: "turn-1",
          sessionKey: "weixin",
          args: {},
        }),
      });
      const wrongPathUrl = new URL(endpoint.url);
      wrongPathUrl.pathname = "/not-browser";
      const wrongPath = await fetch(wrongPathUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(wrongMethod.status).toBe(405);
      expect(unknownTool.status).toBe(400);
      expect(await unknownTool.json()).toMatchObject({ error: "invalid-tool" });
      expect(wrongPath.status).toBe(404);
      expect(browserToolService.navigate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("exposes provider status, connect/disconnect, cleanup, and blocks private navigation by default", async () => {
    const BrowserWindow = vi.fn((options) => new FakeBrowserToolWindow(options));
    const service = createDesktopBrowserToolService({
      BrowserWindow,
      visible: false,
      operationTimeoutMs: 500,
      angelChromeProvider: createLegacyElectronProfileShim(BrowserWindow, {
        visible: false,
        operationTimeoutMs: 500,
      }),
    });

    expect(service.status()).toMatchObject({
      success: true,
      connected: true,
      status: "connected",
      session_count: 0,
    });
    await expect(
      service.navigate({
        turnId: "turn-local",
        sessionKey: "desktop:local",
        url: "http://127.0.0.1:3000",
        profile: "angel",
      }),
    ).rejects.toThrow(/private\/local host/u);

    await service.navigate({
      turnId: "turn-remote",
      sessionKey: "desktop:remote",
      url: "https://example.test/page",
      profile: "angel",
    });
    expect(service.status()).toMatchObject({
      connected: true,
      session_count: 1,
      sessions: [expect.objectContaining({ sessionKey: "desktop:remote" })],
    });

    const disconnected = service.disconnect();
    expect(disconnected).toMatchObject({
      success: true,
      connected: false,
      status: "disconnected",
    });
    expect(service.status()).toMatchObject({
      connected: false,
      session_count: 0,
      sessions: [],
    });
    expect(
      await service.navigate({
        turnId: "turn-off",
        sessionKey: "desktop:off",
        url: "https://example.test/page",
        profile: "angel",
      }),
    ).toMatchObject({
      success: false,
      error: expect.stringContaining("disconnected"),
    });
    expect(service.connect()).toMatchObject({ success: true, connected: true });
    await service.navigate({
      turnId: "turn-clean",
      sessionKey: "desktop:clean",
      url: "https://example.test/page",
      profile: "angel",
    });
    const cleanup = service.cleanup();
    expect(cleanup).toMatchObject({
      success: true,
      closed_session_count: expect.any(Number),
      session_count: 0,
    });
  });
});

function createFakeProfileProvider({ providerId, profile, title, text }) {
  let connected = true;
  let lastClosedCount = 0;
  const sessions = new Map();
  return {
    navigate: vi.fn(async ({ sessionKey, url }) => {
      const id = sessionKey ?? `desktop:${profile}`;
      sessions.set(id, { sessionKey: id, provider_id: providerId, profile, title });
      return {
        success: true,
        url,
        title,
        snapshot: text,
        element_count: 1,
        metadata: {
          provider_id: providerId,
          profile,
        },
      };
    }),
    snapshot: vi.fn(async () => ({
      success: true,
      title,
      text,
      element_count: 1,
      metadata: {
        provider_id: providerId,
        profile,
      },
    })),
    status: vi.fn(() => ({
      success: true,
      connected,
      provider_id: providerId,
      profile,
      status: connected ? "connected" : "disconnected",
      session_count: sessions.size,
      sessions: [...sessions.values()],
      last_closed_count: lastClosedCount,
      capabilities: {
        supports_managed_launch: profile === "angel",
        supports_existing_session: profile === "user",
      },
    })),
    connect: vi.fn(() => {
      connected = true;
      return {
        success: true,
        connected: true,
        provider_id: providerId,
        profile,
        status: "connected",
        session_count: sessions.size,
      };
    }),
    disconnect: vi.fn(() => {
      connected = false;
      lastClosedCount = sessions.size;
      sessions.clear();
      return {
        success: true,
        connected: false,
        provider_id: providerId,
        profile,
        status: "disconnected",
        closed_session_count: lastClosedCount,
        session_count: 0,
      };
    }),
    cleanup: vi.fn(() => {
      lastClosedCount = sessions.size;
      sessions.clear();
      return {
        success: true,
        provider_id: providerId,
        profile,
        closed_session_count: lastClosedCount,
        session_count: 0,
        sessions: [],
      };
    }),
    cleanupExpired: vi.fn(),
  };
}

function createLegacyElectronProfileShim(BrowserWindow, { visible = false, operationTimeoutMs = 500 } = {}) {
  const sessions = new Map();
  const snapshots = new Map();
  let connected = true;
  return {
    async navigate({ turnId, sessionKey, url }) {
      let window = sessions.get(sessionKey);
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({
          title: "Director Angel 浏览器工具",
          show: visible,
          skipTaskbar: visible !== true,
          webPreferences: {
            partition: "persist:director-angel-browser-tools",
          },
        });
        window.directorAngelWindowRole = "director-angel-browser-tool";
        sessions.set(sessionKey, window);
      }
      await window.loadURL(url);
      const snapshot = await window.webContents.executeJavaScript("", true);
      snapshots.set(sessionKey, snapshot);
      return {
        success: true,
        url: snapshot.url || url,
        title: snapshot.title,
        snapshot: snapshot.text,
        element_count: snapshot.elements?.length ?? 0,
        metadata: {
          turnId,
          session_id: sessionKey,
          provider_id: "angel-managed-chrome",
          profile: "angel",
          refs: snapshot.elements ?? [],
        },
      };
    },
    async snapshot({ sessionKey }) {
      const window = sessions.get(sessionKey);
      if (!window || window.isDestroyed()) {
        return { success: false, error: "No browser session exists" };
      }
      const snapshot = await window.webContents.executeJavaScript("", true);
      snapshots.set(sessionKey, snapshot);
      return {
        success: true,
        url: snapshot.url,
        title: snapshot.title,
        text: snapshot.text,
        element_count: snapshot.elements?.length ?? 0,
        metadata: {
          session_id: sessionKey,
          provider_id: "angel-managed-chrome",
          profile: "angel",
          refs: snapshot.elements ?? [],
        },
      };
    },
    async click({ sessionKey, ref }) {
      const window = sessions.get(sessionKey);
      const element = (snapshots.get(sessionKey)?.elements ?? []).find((item) => item.ref === ref);
      if (!element) {
        return { success: false, error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.` };
      }
      await window.webContents.executeJavaScript(`document.querySelector('[data-director-browser-ref="${String(ref).replace(/^@e/u, "")}"]')`, true);
      return { success: true, clicked: ref };
    },
    async type({ sessionKey, ref, text }) {
      const window = sessions.get(sessionKey);
      const element = (snapshots.get(sessionKey)?.elements ?? []).find((item) => item.ref === ref);
      if (!element) {
        return { success: false, error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.` };
      }
      try {
        await window.webContents.executeJavaScript(`document.querySelector('[data-director-browser-ref="${String(ref).replace(/^@e/u, "")}"]').value = ${JSON.stringify(text)}`, true);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { success: true, typed: text };
    },
    async scroll({ sessionKey, direction, pages }) {
      const window = sessions.get(sessionKey);
      await window.webContents.executeJavaScript("window.scrollBy(0, 1)", true);
      return { success: true, direction, pages };
    },
    async press({ sessionKey, key }) {
      const window = sessions.get(sessionKey);
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
      return { success: true, key };
    },
    async getImages({ sessionKey }) {
      const window = sessions.get(sessionKey);
      const images = await window.webContents.executeJavaScript("document.images", true);
      return { success: true, image_count: images.length, images };
    },
    async console({ sessionKey, clear, expression }) {
      const window = sessions.get(sessionKey);
      const result = await window.webContents.executeJavaScript(
        `const value = (() => (${expression}))()`,
        true,
      );
      return { success: true, result, cleared: clear === true };
    },
    status: () => ({
      success: true,
      connected,
      provider_id: "angel-managed-chrome",
      profile: "angel",
      status: connected ? "connected" : "disconnected",
      session_count: sessions.size,
      sessions: [...sessions.keys()].map((sessionKey) => ({ sessionKey, provider_id: "angel-managed-chrome", profile: "angel" })),
    }),
    connect: () => {
      connected = true;
      return { success: true, connected: true, provider_id: "angel-managed-chrome", profile: "angel" };
    },
    disconnect: () => {
      const count = sessions.size;
      for (const window of sessions.values()) {
        window.close();
      }
      sessions.clear();
      connected = false;
      return {
        success: true,
        connected: false,
        provider_id: "angel-managed-chrome",
        profile: "angel",
        closed_session_count: count,
        session_count: 0,
      };
    },
    cleanup: () => {
      const count = sessions.size;
      for (const window of sessions.values()) {
        window.close();
      }
      sessions.clear();
      return { success: true, closed_session_count: count, session_count: 0 };
    },
    cleanupExpired: () => {},
    _operationTimeoutMs: operationTimeoutMs,
  };
}

class FakeBrowserToolWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.clickedRefs = [];
    this.typed = [];
    this.sentInputEvents = [];
    this.executedScripts = [];
    this.currentUrl = "";
    this.webContents = {
      executeJavaScript: vi.fn(async (script) => this.execute(script)),
      sendInputEvent: vi.fn((event) => {
        this.sentInputEvents.push(event);
      }),
      on: vi.fn(),
    };
  }

  async loadURL(url) {
    this.currentUrl = url;
  }

  setTitle() {}

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    this.destroyed = true;
  }

  execute(script) {
    this.executedScripts.push(script);
    if (script.includes("document.querySelector('[data-director-browser-ref")) {
      if (script.includes('data-director-browser-ref="1"')) {
        this.clickedRefs.push("@e1");
        return true;
      }
      if (script.includes('data-director-browser-ref="2"')) {
        this.typed.push("@e2");
        return true;
      }
      throw new Error("Unknown browser ref");
    }
    if (script.includes("window.scrollBy")) {
      return { x: 0, y: 1640 };
    }
    if (script.includes("document.images")) {
      return [
        {
          src: "https://example.test/a.png",
          alt: "A",
          width: 100,
          height: 80,
          visible: true,
        },
      ];
    }
    if (script.includes("const value = (() => (document.title))()")) {
      return "Example Page";
    }
    return {
      url: this.currentUrl,
      title: "Example Page",
      text: "[@e1] link Docs\n[@e2] textbox Search",
      elements: [
        { ref: "@e1", role: "link", name: "Docs", selector: "[data-director-browser-ref=\"1\"]" },
        {
          ref: "@e2",
          role: "textbox",
          name: "Search",
          selector: "[data-director-browser-ref=\"2\"]",
        },
      ],
    };
  }
}

function createFakeChromeCdp(options = {}) {
  const calls = [];
  let targetListFailuresRemaining = Math.max(0, Number(options.failTargetListCount ?? 0));
  let launched = options.requireLaunch !== true;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = new Map();
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    send(payload) {
      const message = JSON.parse(payload);
      calls.push({ method: message.method, params: message.params });
      const result = fakeChromeCdpResultFor(message.method, message.params);
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify({
            id: message.id,
            result,
          }),
        });
      });
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close", {});
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  const fetchImpl = vi.fn(async (url) => {
    if (!launched) {
      throw new Error("Chrome is not launched yet");
    }
    if (targetListFailuresRemaining > 0 && String(url).endsWith("/json")) {
      targetListFailuresRemaining -= 1;
      throw new Error("CDP not ready yet");
    }
    if (String(url).endsWith("/json/version")) {
      return {
        ok: true,
        json: async () => ({
          Browser: "Chrome/126",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-1",
        }),
      };
    }
    if (String(url).endsWith("/json")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "page-1",
            type: "page",
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/page-1",
          },
        ],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

  return {
    calls,
    fetchImpl,
    markLaunched: () => {
      launched = true;
    },
    WebSocketImpl: FakeWebSocket,
    provider: createChromeCdpBrowserProvider({
      cdpUrl: "http://127.0.0.1:9222",
      operationTimeoutMs: 500,
      maxSnapshotChars: 8000,
      sessionTtlMs: 60_000,
      nowMs: () => Date.now(),
      fetchImpl,
      WebSocketImpl: FakeWebSocket,
    }),
  };
}

function fakeChromeCdpResultFor(method, params) {
  if (method === "Runtime.evaluate") {
    if (params.expression === "document.readyState") {
      return { result: { value: "complete" } };
    }
    const full = String(params.expression).includes("root ? (root.innerText");
    return {
      result: {
        value: {
          url: "https://mp.weixin.qq.com/s/article",
          title: "Chrome Article",
          text: full
            ? "真实 Chrome 登录态正文\n这一页需要登录态才能读完整。"
            : "[@e1] link 继续阅读",
          elements: [{ ref: "@e1", role: "link", name: "继续阅读", selector: "[data-director-browser-ref=\"1\"]" }],
        },
      },
    };
  }
  return {};
}
