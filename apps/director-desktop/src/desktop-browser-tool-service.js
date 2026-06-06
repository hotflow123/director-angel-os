import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";
import { createServer } from "node:http";

const DEFAULT_PARTITION = "persist:director-angel-browser-tools";
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SNAPSHOT_CHARS = 8_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_TOOL_SERVER_HOST = "127.0.0.1";
const DEFAULT_TOOL_SERVER_PATH = "/tool";
const DEFAULT_TOOL_SERVER_REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOOL_SERVER_REQUEST_BYTES = 128 * 1024;
const BROWSER_TOOL_WINDOW_ROLE = "director-angel-browser-tool";
const DEFAULT_PROVIDER_ID = "angel-managed-chrome";
const ANGEL_PROVIDER_ID = "angel-managed-chrome";
const CHROME_PROVIDER_ID = "chrome-existing-session";
const SUPPORTED_BROWSER_PROFILES = Object.freeze(["angel", "user"]);
const DEFAULT_CHROME_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_ANGEL_CHROME_CDP_URL = "http://127.0.0.1:9223";
const DEFAULT_CDP_DISCOVERY_TIMEOUT_MS = 2_000;
const DEFAULT_CDP_LAUNCH_READY_TIMEOUT_MS = 8_000;
const DEFAULT_CDP_LAUNCH_READY_POLL_MS = 250;
const DEFAULT_ANGEL_CHROME_USER_DATA_DIR = join(
  homedir(),
  ".director-angel",
  "browser",
  "angel-chrome",
);
const DARWIN_CHROMIUM_EXECUTABLES = Object.freeze([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]);
const DEFAULT_BLOCKED_LOCAL_HOSTS = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
  "169.254.169.254",
]);
const ELECTRON_PROFILE_BLOCKED_MESSAGE =
  "Director Angel 已禁止用 Electron 直接打开网页；请使用 profile=angel 的受控浏览器，或在用户明确要求真实登录态时使用 profile=user。";
const MANAGED_CHROME_LAUNCH_BLOCKED_MESSAGE =
  "Director Angel 已禁止自动启动私有/空白 Chrome；只能复用已连接的 Browser Bridge/CDP 会话，不能在桌面端失败时偷偷拉起新浏览器。";
const BROWSER_TOOL_METHODS = Object.freeze({
  browser_navigate: "navigate",
  browser_snapshot: "snapshot",
  browser_click: "click",
  browser_type: "type",
  browser_scroll: "scroll",
  browser_back: "back",
  browser_press: "press",
  browser_get_images: "getImages",
  browser_console: "console",
  browser_status: "status",
  browser_connect: "connect",
  browser_disconnect: "disconnect",
  browser_cleanup: "cleanup",
});

export function createDesktopBrowserToolServer({
  browserToolService,
  host = DEFAULT_TOOL_SERVER_HOST,
  path = DEFAULT_TOOL_SERVER_PATH,
  requestTimeoutMs = DEFAULT_TOOL_SERVER_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof browserToolService !== "object" || browserToolService === null) {
    throw new Error("Desktop browser tool server requires browserToolService.");
  }

  let server = null;
  let endpointUrl = "";

  return {
    get url() {
      return endpointUrl;
    },
    async start({ port = 0 } = {}) {
      if (server !== null) {
        return { url: endpointUrl };
      }
      server = createServer((request, response) => {
        void handleDesktopBrowserToolRequest(request, response, {
          browserToolService,
          path,
          requestTimeoutMs,
        });
      });
      await new Promise((resolveStart, rejectStart) => {
        const onError = (error) => {
          server?.off("listening", onListening);
          rejectStart(error);
        };
        const onListening = () => {
          server?.off("error", onError);
          resolveStart();
        };
        server?.once("error", onError);
        server?.once("listening", onListening);
        server?.listen({ host, port });
      });
      const address = server.address();
      const listeningPort =
        typeof address === "object" && address !== null && Number.isFinite(address.port)
          ? address.port
          : port;
      endpointUrl = `http://${host}:${listeningPort}${path}`;
      return { url: endpointUrl };
    },
    async close() {
      if (server === null) {
        return;
      }
      const currentServer = server;
      server = null;
      endpointUrl = "";
      await new Promise((resolveClose, rejectClose) => {
        currentServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}

export function createChromeCdpBrowserProvider({
  cdpUrl,
  operationTimeoutMs,
  maxSnapshotChars,
  sessionTtlMs,
  nowMs,
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
  allowRemoteCdp = false,
  providerId = CHROME_PROVIDER_ID,
  profile = "user",
  mode = "local-existing-session",
  launch,
  launchOnConnect = false,
  launchOnNavigate = false,
  managedLaunchAllowed = process.env.DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH === "1",
  unavailableMessage,
  setupNextActions,
} = {}) {
  const sessions = new Map();
  let activeCdpUrl = normalizeChromeCdpUrl(cdpUrl);
  let connected = true;
  let discovered = null;
  let lastError = "";
  let lastLaunch = null;
  let lastClosedCount = 0;
  let lastCdpControl = createChromeCdpControlStatus({
    cdpUrl: activeCdpUrl,
    discovered: null,
    cdpHttp: false,
    cdpReady: false,
    error: "",
  });

  async function navigate({ turnId, sessionKey, url }) {
    if (!connected) {
      return createChromeExistingSessionUnavailableResult({
        providerId,
        requestedProfile: profile,
        cdpUrl: activeCdpUrl,
        detail: `${profile} Chrome provider is disconnected.`,
        cdpControl: lastCdpControl,
        security: createChromeCdpSecurityStatus(activeCdpUrl, { allowRemoteCdp }),
        capabilities: createChromeCdpProviderCapabilities({ mode }),
        unavailableMessage,
        setupNextActions,
      });
    }
    try {
      const page = await getOrCreateCdpSession({ turnId, sessionKey });
      await page.call("Page.enable", {});
      await page.call("Runtime.enable", {});
      await page.call("Page.navigate", { url });
      await delay(500);
      await waitForChromeCdpSettled(page, operationTimeoutMs);
      const snapshot = await captureChromeCdpSnapshot(page, {
        full: false,
        maxSnapshotChars,
        operationTimeoutMs,
      });
      page.lastSnapshot = snapshot;
      touchCdpSession(page);
      return {
        success: true,
        url: snapshot.url || url,
        title: snapshot.title,
        snapshot: snapshot.text,
        element_count: snapshot.elements.length,
        metadata: {
          session_id: page.id,
          provider_id: providerId,
          profile,
          cdp_url: redactChromeCdpUrl(activeCdpUrl),
          target_id: page.targetId,
          refs: snapshot.elements,
        },
      };
    } catch (error) {
      lastError = toErrorMessage(error);
      return createChromeExistingSessionUnavailableResult({
        providerId,
        requestedProfile: profile,
        cdpUrl: activeCdpUrl,
        detail: lastError,
        cdpControl: lastCdpControl,
        security: createChromeCdpSecurityStatus(activeCdpUrl, { allowRemoteCdp }),
        capabilities: createChromeCdpProviderCapabilities({ mode }),
        unavailableMessage,
        setupNextActions,
      });
    }
  }

  async function snapshot({ turnId, sessionKey, full = false }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return {
        success: false,
        error: `No Chrome browser session exists for profile=${profile}. Call browser_navigate with profile=${profile} first.`,
        metadata: {
          provider_id: providerId,
          profile,
        },
      };
    }
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full,
      maxSnapshotChars: full ? Math.max(maxSnapshotChars, 32_000) : maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      url: snapshotResult.url,
      title: snapshotResult.title,
      text: snapshotResult.text,
      elements: snapshotResult.elements,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: page.id,
        provider_id: providerId,
        profile,
        truncated: snapshotResult.truncated,
      },
    };
  }

  async function click({ turnId, sessionKey, ref }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    const element = getElementByRef(page, ref);
    if (element === null) {
      return {
        success: false,
        error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.`,
        metadata: { provider_id: providerId, profile },
      };
    }
    await chromeCdpEvaluate(page, createBrowserElementActionScript({ ref: element.ref, action: "click", text: "" }));
    await delay(250);
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      clicked: element.ref,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  async function type({ turnId, sessionKey, ref, text }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    const element = getElementByRef(page, ref);
    if (element === null) {
      return {
        success: false,
        error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.`,
        metadata: { provider_id: providerId, profile },
      };
    }
    await chromeCdpEvaluate(page, createBrowserElementActionScript({ ref: element.ref, action: "type", text }));
    await delay(150);
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      element: element.ref,
      typed: text,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  async function scroll({ turnId, sessionKey, direction, pages = 1 }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    const normalizedDirection = normalizeScrollDirection(direction);
    if (normalizedDirection === null) {
      return {
        success: false,
        error: "Scroll direction must be up, down, left, or right.",
        metadata: { provider_id: providerId, profile },
      };
    }
    const normalizedPages = normalizeScrollPages(pages);
    await chromeCdpEvaluate(page, createBrowserScrollScript({ direction: normalizedDirection, pages: normalizedPages }));
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      direction: normalizedDirection,
      pages: normalizedPages,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  async function back({ turnId, sessionKey }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    await chromeCdpEvaluate(page, "history.back(); true");
    await waitForChromeCdpSettled(page, operationTimeoutMs);
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      url: snapshotResult.url,
      title: snapshotResult.title,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  async function press({ turnId, sessionKey, key }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    const normalizedKey = normalizeKeyCode(key);
    if (normalizedKey.length === 0) {
      return {
        success: false,
        error: "browser_press requires a non-empty key.",
        metadata: { provider_id: providerId, profile },
      };
    }
    await chromeCdpEvaluate(page, createBrowserPressScript({ key: normalizedKey }));
    await delay(100);
    const snapshotResult = await captureChromeCdpSnapshot(page, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    page.lastSnapshot = snapshotResult;
    touchCdpSession(page);
    return {
      success: true,
      key: normalizedKey,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  async function getImages({ turnId, sessionKey }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    const images = normalizeBrowserImages(await chromeCdpEvaluate(page, createBrowserGetImagesScript()));
    touchCdpSession(page);
    return {
      success: true,
      images,
      image_count: images.length,
      metadata: {
        session_id: page.id,
        provider_id: providerId,
        profile,
        url: page.lastSnapshot?.url ?? "",
      },
    };
  }

  async function consoleTool({ turnId, sessionKey, clear = false, expression }) {
    const page = getExistingCdpSession({ turnId, sessionKey });
    if (page === null) {
      return chromeCdpMissingSessionResult({ providerId, profile });
    }
    let result;
    if (typeof expression === "string" && expression.trim().length > 0) {
      result = await chromeCdpEvaluate(page, createBrowserConsoleExpressionScript(expression));
    }
    const messages = [...page.consoleMessages];
    if (clear) {
      page.consoleMessages.length = 0;
    }
    touchCdpSession(page);
    return {
      success: true,
      result,
      messages,
      cleared: Boolean(clear),
      metadata: { session_id: page.id, provider_id: providerId, profile },
    };
  }

  function status() {
    cleanupExpired();
    return {
      success: true,
      connected,
      provider_id: providerId,
      implementation: "chrome-devtools-protocol-existing-session-provider",
      profile,
      mode,
      cdp_url: redactChromeCdpUrl(activeCdpUrl),
      status: connected ? (discovered === null ? "configured" : "connected") : "disconnected",
      session_count: sessions.size,
      sessions: listSessions(),
      capabilities: createChromeCdpProviderCapabilities({ mode }),
      cdp_control: lastCdpControl,
      security: createChromeCdpSecurityStatus(activeCdpUrl, { allowRemoteCdp }),
      launch: lastLaunch,
      last_error: lastError,
      last_closed_count: lastClosedCount,
      next_actions: setupNextActions ?? [
        "复用已经连接的 Browser Bridge/CDP 会话",
        "用户明确要求谷歌浏览器/Chrome 且已有连接时才走该 profile",
      ],
    };
  }

  async function connect({ url, cdpUrl: nextCdpUrl } = {}) {
    const candidate = normalizeChromeCdpUrl(nextCdpUrl ?? url ?? activeCdpUrl);
    try {
      assertChromeCdpControlAllowed(candidate, { allowRemoteCdp });
      if (launchOnConnect && typeof launch === "function") {
        if (!managedLaunchAllowed) {
          throw new Error(MANAGED_CHROME_LAUNCH_BLOCKED_MESSAGE);
        }
        lastLaunch = await launch({ cdpUrl: candidate });
      }
      discovered = await waitForChromeCdpEndpoint({
        cdpUrl: candidate,
        fetchImpl,
        discoveryTimeoutMs: DEFAULT_CDP_DISCOVERY_TIMEOUT_MS,
        readyTimeoutMs: DEFAULT_CDP_LAUNCH_READY_TIMEOUT_MS,
        pollMs: DEFAULT_CDP_LAUNCH_READY_POLL_MS,
        allowRemoteCdp,
      });
      activeCdpUrl = candidate;
      lastCdpControl = createChromeCdpControlStatus({
        cdpUrl: candidate,
        discovered,
        cdpHttp: true,
        cdpReady: true,
        error: "",
      });
      connected = true;
      lastError = "";
      return {
        success: true,
        connected: true,
        provider_id: providerId,
        implementation: "chrome-devtools-protocol-existing-session-provider",
        profile,
        mode,
        status: "connected",
        cdp_url: redactChromeCdpUrl(candidate),
        browser: discovered.browser,
        capabilities: createChromeCdpProviderCapabilities({ mode }),
        cdp_control: lastCdpControl,
        security: createChromeCdpSecurityStatus(candidate, { allowRemoteCdp }),
        launch: lastLaunch,
        webSocketDebuggerUrl: redactChromeCdpUrl(discovered.browserWebSocketUrl),
        next_actions: [`现在可以用 browser_navigate profile=${profile} 读取该 Chrome profile 页面`],
      };
    } catch (error) {
      lastError = toErrorMessage(error);
      lastCdpControl = createChromeCdpControlStatus({
        cdpUrl: candidate,
        discovered: null,
        cdpHttp: false,
        cdpReady: false,
        error: lastError,
      });
      return createChromeExistingSessionUnavailableResult({
        providerId,
        requestedProfile: profile,
        cdpUrl: candidate,
        detail: lastError,
        cdpControl: lastCdpControl,
        security: createChromeCdpSecurityStatus(candidate, { allowRemoteCdp }),
        capabilities: createChromeCdpProviderCapabilities({ mode }),
        unavailableMessage,
        setupNextActions,
      });
    }
  }

  function disconnect() {
    connected = false;
    closeAll();
    return {
      success: true,
      connected: false,
      provider_id: providerId,
      implementation: "chrome-devtools-protocol-existing-session-provider",
      profile,
      mode,
      status: "disconnected",
      closed_session_count: lastClosedCount,
      next_actions: setupNextActions ?? ["需要真实 Chrome 登录态时，先连接 Chrome CDP provider"],
    };
  }

  function cleanup({ sessionKey } = {}) {
    const before = sessions.size;
    if (typeof sessionKey === "string" && sessionKey.trim().length > 0) {
      const session = sessions.get(normalizeSessionId(sessionKey));
      if (session) {
        closeCdpSession(session);
        sessions.delete(session.id);
      }
    } else {
      closeAll();
    }
    lastClosedCount = Math.max(0, before - sessions.size);
    return status();
  }

  function cleanupExpired() {
    const cutoff = nowMs() - sessionTtlMs;
    let closed = 0;
    for (const [id, session] of sessions.entries()) {
      if (session.lastUsedAtMs >= cutoff && session.socket?.readyState === WebSocketImpl.OPEN) {
        continue;
      }
      closeCdpSession(session);
      sessions.delete(id);
      closed += 1;
    }
    lastClosedCount = closed;
  }

  async function getOrCreateCdpSession({ turnId, sessionKey }) {
    cleanupExpired();
    const id = normalizeSessionId(sessionKey);
    const existing = sessions.get(id);
    if (existing && existing.socket?.readyState === WebSocketImpl.OPEN) {
      existing.turnId = turnId;
      touchCdpSession(existing);
      return existing;
    }
    const endpoint = await resolveChromeCdpPageEndpointWithLaunch();
    const page = await connectChromeCdpPage({
      id,
      turnId,
      sessionKey,
      targetId: endpoint.targetId,
      webSocketDebuggerUrl: endpoint.webSocketDebuggerUrl,
      WebSocketImpl,
      operationTimeoutMs,
      nowMs,
    });
    sessions.set(id, page);
    return page;
  }

  async function resolveChromeCdpPageEndpointWithLaunch() {
    try {
      return await resolveChromeCdpPageEndpoint();
    } catch (error) {
      if (!launchOnNavigate || typeof launch !== "function") {
        throw error;
      }
      if (!managedLaunchAllowed) {
        throw error;
      }
      lastLaunch = await launch({ cdpUrl: activeCdpUrl });
      return await resolveChromeCdpPageEndpoint({
        readyTimeoutMs: DEFAULT_CDP_LAUNCH_READY_TIMEOUT_MS,
      });
    }
  }

  function getExistingCdpSession({ turnId, sessionKey }) {
    cleanupExpired();
    const session = sessions.get(normalizeSessionId(sessionKey));
    if (!session || session.socket?.readyState !== WebSocketImpl.OPEN) {
      return null;
    }
    session.turnId = turnId;
    touchCdpSession(session);
    return session;
  }

  async function resolveChromeCdpPageEndpoint(options = {}) {
    assertChromeCdpControlAllowed(activeCdpUrl, { allowRemoteCdp });
    const endpoint = await waitForChromeCdpEndpoint({
      cdpUrl: activeCdpUrl,
      fetchImpl,
      discoveryTimeoutMs: DEFAULT_CDP_DISCOVERY_TIMEOUT_MS,
      readyTimeoutMs:
        Number.isFinite(options.readyTimeoutMs) && options.readyTimeoutMs > 0
          ? options.readyTimeoutMs
          : DEFAULT_CDP_DISCOVERY_TIMEOUT_MS,
      pollMs: DEFAULT_CDP_LAUNCH_READY_POLL_MS,
      allowRemoteCdp,
    });
    discovered = endpoint;
    lastCdpControl = createChromeCdpControlStatus({
      cdpUrl: activeCdpUrl,
      discovered: endpoint,
      cdpHttp: true,
      cdpReady: true,
      error: "",
    });
    lastError = "";
    return endpoint;
  }

  function touchCdpSession(session) {
    session.lastUsedAtMs = nowMs();
  }

  function listSessions() {
    return [...sessions.values()].map((session) => ({
      id: session.id,
      sessionKey: session.sessionKey,
      turnId: session.turnId,
      lastUsedAtMs: session.lastUsedAtMs,
      url: session.lastSnapshot?.url ?? "",
      title: session.lastSnapshot?.title ?? "",
      provider_id: providerId,
      profile,
      targetId: session.targetId,
      destroyed: session.socket?.readyState !== WebSocketImpl.OPEN,
    }));
  }

  function closeAll() {
    const before = sessions.size;
    for (const session of sessions.values()) {
      closeCdpSession(session);
    }
    sessions.clear();
    lastClosedCount = before;
  }

  return {
    navigate,
    snapshot,
    click,
    type,
    scroll,
    back,
    press,
    getImages,
    console: consoleTool,
    status,
    connect,
    disconnect,
    cleanup,
    cleanupExpired,
    closeAll,
    _sessions: sessions,
  };
}

export function createDesktopBrowserToolService({
  BrowserWindow,
  partition = DEFAULT_PARTITION,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  maxSnapshotChars = DEFAULT_MAX_SNAPSHOT_CHARS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  visible = true,
  allowPrivateUrls = false,
  providerId = DEFAULT_PROVIDER_ID,
  nowMs = () => Date.now(),
  chromeCdpUrl =
    process.env.DIRECTOR_CHROME_CDP_URL?.trim() ||
    process.env.BROWSER_CDP_URL?.trim() ||
    DEFAULT_CHROME_CDP_URL,
  angelChromeCdpUrl =
    process.env.DIRECTOR_ANGEL_CHROME_CDP_URL?.trim() ||
    process.env.ANGEL_BROWSER_CDP_URL?.trim() ||
    DEFAULT_ANGEL_CHROME_CDP_URL,
  angelChromeUserDataDir =
    process.env.DIRECTOR_ANGEL_CHROME_USER_DATA_DIR?.trim() ||
    DEFAULT_ANGEL_CHROME_USER_DATA_DIR,
  chromeExistingSessionProvider = createChromeCdpBrowserProvider({
    cdpUrl: chromeCdpUrl,
    operationTimeoutMs,
    maxSnapshotChars,
    sessionTtlMs,
    nowMs,
  }),
  angelChromeProvider = createChromeCdpBrowserProvider({
    cdpUrl: angelChromeCdpUrl,
    operationTimeoutMs,
    maxSnapshotChars,
    sessionTtlMs,
    nowMs,
    providerId: ANGEL_PROVIDER_ID,
    profile: "angel",
    mode: "local-managed-profile",
    launchOnConnect: true,
    managedLaunchAllowed: process.env.DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH === "1",
    launch: ({ cdpUrl }) =>
      launchAngelManagedChrome({
        cdpUrl,
        userDataDir: angelChromeUserDataDir,
        allowManagedLaunch: process.env.DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH === "1",
      }),
    unavailableMessage:
      "Angel 专用 Chrome 当前没有已连接会话。系统不会用 Electron 或空白浏览器兜底；请先建立已授权的 Browser Bridge/CDP 会话后再继续。",
    setupNextActions: [
      "复用已经连接的 Browser Bridge/CDP profile=angel",
      "需要真实登录态时明确使用已连接的 profile=user",
      "没有已连接会话时应返回失败，不应打开新浏览器窗口",
    ],
  }),
} = {}) {
  if (typeof BrowserWindow !== "function") {
    throw new Error("Desktop browser tool service requires Electron BrowserWindow.");
  }
  const sessions = new Map();
  const sessionRoutes = new Map();
  let connected = true;
  let lastError = "";

  async function navigate({ turnId, sessionKey, url, profile }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    const normalizedProfile = normalizeBrowserProfile(profile);
    if (normalizedProfile === "electron") {
      return createBlockedElectronProfileResult();
    }
    if (!isSupportedBrowserProfile(normalizedProfile)) {
      return createUnsupportedBrowserProfileResult(normalizedProfile);
    }
    if (normalizedProfile === "angel") {
      assertBrowserToolUrl(url);
      assertBrowserNavigationAllowed(url, { allowPrivateUrls });
      const result = await Promise.resolve(
        angelChromeProvider.navigate({
          turnId,
          sessionKey,
          url,
        }),
      );
      if (result?.success === true) {
        sessionRoutes.set(normalizeSessionId(sessionKey), "angel");
      }
      return result;
    }
    if (normalizedProfile === "user") {
      assertBrowserToolUrl(url);
      assertBrowserNavigationAllowed(url, { allowPrivateUrls });
      const result = await Promise.resolve(
        chromeExistingSessionProvider.navigate({
          turnId,
          sessionKey,
          url,
        }),
      );
      if (result?.success === true) {
        sessionRoutes.set(normalizeSessionId(sessionKey), "chrome");
      }
      return result;
    }
    assertBrowserToolUrl(url);
    assertBrowserNavigationAllowed(url, { allowPrivateUrls });
    const result = await Promise.resolve(
      angelChromeProvider.navigate({
        turnId,
        sessionKey,
        url,
      }),
    );
    if (result?.success === true) {
      sessionRoutes.set(normalizeSessionId(sessionKey), "angel");
    }
    return result;
  }

  async function snapshot({ turnId, sessionKey, full = false }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.snapshot({ turnId, sessionKey, full });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.snapshot({ turnId, sessionKey, full });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const snapshotResult = await captureSnapshot(session, {
      full,
      maxSnapshotChars: full ? Math.max(maxSnapshotChars, 32_000) : maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      url: snapshotResult.url,
      title: snapshotResult.title,
      text: snapshotResult.text,
      elements: snapshotResult.elements,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
        truncated: snapshotResult.truncated,
      },
    };
  }

  async function click({ turnId, sessionKey, ref }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.click({ turnId, sessionKey, ref });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.click({ turnId, sessionKey, ref });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const element = getElementByRef(session, ref);
    if (element === null) {
      return {
        success: false,
        error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.`,
      };
    }
    await runElementScript(session.window, element.ref, "click", "", operationTimeoutMs);
    const snapshotResult = await captureSnapshot(session, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      clicked: element.ref,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  async function type({ turnId, sessionKey, ref, text }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.type({ turnId, sessionKey, ref, text });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.type({ turnId, sessionKey, ref, text });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const element = getElementByRef(session, ref);
    if (element === null) {
      return {
        success: false,
        error: `Unknown browser ref ${ref}. Call browser_snapshot and use a current ref.`,
      };
    }
    await runElementScript(session.window, element.ref, "type", text, operationTimeoutMs);
    const snapshotResult = await captureSnapshot(session, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      element: element.ref,
      typed: text,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  async function scroll({ turnId, sessionKey, direction, pages = 1 }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.scroll({ turnId, sessionKey, direction, pages });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.scroll({ turnId, sessionKey, direction, pages });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const normalizedDirection = normalizeScrollDirection(direction);
    if (normalizedDirection === null) {
      return {
        success: false,
        error: "Scroll direction must be up, down, left, or right.",
      };
    }
    const normalizedPages = normalizeScrollPages(pages);
    await withTimeout(
      session.window.webContents.executeJavaScript(
        createBrowserScrollScript({ direction: normalizedDirection, pages: normalizedPages }),
        true,
      ),
      operationTimeoutMs,
      `browser_scroll timed out for ${normalizedDirection}`,
    );
    const snapshotResult = await captureSnapshot(session, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      direction: normalizedDirection,
      pages: normalizedPages,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  async function back({ turnId, sessionKey }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.back({ turnId, sessionKey });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.back({ turnId, sessionKey });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    if (typeof session.window.webContents.canGoBack === "function" && !session.window.webContents.canGoBack()) {
      return {
        success: false,
        error: "No browser history entry is available.",
        metadata: {
          session_id: session.id,
          provider_id: providerId,
        },
      };
    }
    if (typeof session.window.webContents.goBack === "function") {
      session.window.webContents.goBack();
      await waitForBrowserSettled(session.window, operationTimeoutMs);
    } else {
      await withTimeout(
        session.window.webContents.executeJavaScript("history.back(); true", true),
        operationTimeoutMs,
        "browser_back timed out.",
      );
      await delay(250);
    }
    const snapshotResult = await captureSnapshot(session, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      url: snapshotResult.url,
      title: snapshotResult.title,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  async function press({ turnId, sessionKey, key }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.press({ turnId, sessionKey, key });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.press({ turnId, sessionKey, key });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const normalizedKey = normalizeKeyCode(key);
    if (normalizedKey.length === 0) {
      return {
        success: false,
        error: "browser_press requires a non-empty key.",
      };
    }
    if (typeof session.window.webContents.sendInputEvent === "function") {
      session.window.webContents.sendInputEvent({ type: "keyDown", keyCode: normalizedKey });
      session.window.webContents.sendInputEvent({ type: "keyUp", keyCode: normalizedKey });
    } else {
      await withTimeout(
        session.window.webContents.executeJavaScript(
          createBrowserPressScript({ key: normalizedKey }),
          true,
        ),
        operationTimeoutMs,
        `browser_press timed out for ${normalizedKey}`,
      );
    }
    await delay(100);
    const snapshotResult = await captureSnapshot(session, {
      full: false,
      maxSnapshotChars,
      operationTimeoutMs,
    });
    session.lastSnapshot = snapshotResult;
    touchSession(session);
    return {
      success: true,
      key: normalizedKey,
      snapshot: snapshotResult.text,
      element_count: snapshotResult.elements.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  async function getImages({ turnId, sessionKey }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.getImages({ turnId, sessionKey });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.getImages({ turnId, sessionKey });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    const images = normalizeBrowserImages(
      await withTimeout(
        session.window.webContents.executeJavaScript(createBrowserGetImagesScript(), true),
        operationTimeoutMs,
        "browser_get_images timed out.",
      ),
    );
    touchSession(session);
    return {
      success: true,
      images,
      image_count: images.length,
      metadata: {
        session_id: session.id,
        provider_id: providerId,
        url: session.lastSnapshot?.url ?? "",
      },
    };
  }

  async function consoleTool({ turnId, sessionKey, clear = false, expression }) {
    if (!connected) {
      return createBrowserProviderUnavailableResult("Browser provider is disconnected.");
    }
    if (getSessionRoute(sessionKey) === "angel") {
      return angelChromeProvider.console({ turnId, sessionKey, clear, expression });
    }
    if (getSessionRoute(sessionKey) === "chrome") {
      return chromeExistingSessionProvider.console({ turnId, sessionKey, clear, expression });
    }
    const session = getExistingSession({ turnId, sessionKey });
    if (session === null) {
      return {
        success: false,
        error: "No browser session exists. Call browser_navigate first.",
      };
    }
    let result;
    if (typeof expression === "string" && expression.trim().length > 0) {
      result = await withTimeout(
        session.window.webContents.executeJavaScript(
          createBrowserConsoleExpressionScript(expression),
          true,
        ),
        operationTimeoutMs,
        "browser_console expression timed out.",
      );
    }
    const messages = [...session.consoleMessages];
    if (clear) {
      session.consoleMessages.length = 0;
    }
    touchSession(session);
    return {
      success: true,
      result,
      messages,
      cleared: Boolean(clear),
      metadata: {
        session_id: session.id,
        provider_id: providerId,
      },
    };
  }

  function status() {
    cleanupExpiredSessions();
    angelChromeProvider.cleanupExpired?.();
    chromeExistingSessionProvider.cleanupExpired?.();
    const angelStatus = angelChromeProvider.status?.() ?? {
      provider_id: ANGEL_PROVIDER_ID,
      status: "unavailable",
      connected: false,
      session_count: 0,
    };
    const chromeStatus = chromeExistingSessionProvider.status?.() ?? {
      provider_id: CHROME_PROVIDER_ID,
      status: "unavailable",
      connected: false,
      session_count: 0,
    };
    return {
      success: true,
      connected,
      provider_id: providerId,
      implementation: "desktop-browser-router",
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      providers: {
        angel: angelStatus,
        user: chromeStatus,
      },
      status: connected ? "connected" : "disconnected",
      session_count:
        sessions.size +
        Number(angelStatus.session_count ?? 0) +
        Number(chromeStatus.session_count ?? 0),
      sessions: [...listSessions(), ...(angelStatus.sessions ?? []), ...(chromeStatus.sessions ?? [])],
      allow_private_urls: allowPrivateUrls,
      visible,
      last_error: lastError,
      next_actions: connected
        ? [
            "default browser_navigate uses profile=angel",
            "use browser_navigate profile=angel for dynamic sites and long-running learning",
            "use browser_navigate profile=user only for explicit real Chrome login-state requests",
            "use browser_cleanup to close stale sessions",
          ]
        : ["call browser_connect before browser_navigate"],
    };
  }

  function connect({ visible: nextVisible } = {}) {
    const requestedProfile = normalizeBrowserProfile(arguments[0]?.profile);
    if (requestedProfile === "electron") {
      return createBlockedElectronProfileResult();
    }
    if (!isSupportedBrowserProfile(requestedProfile)) {
      return createUnsupportedBrowserProfileResult(requestedProfile);
    }
    if (requestedProfile === "angel") {
      return angelChromeProvider.connect(arguments[0] ?? {});
    }
    if (requestedProfile === "user") {
      return chromeExistingSessionProvider.connect(arguments[0] ?? {});
    }
    connected = true;
    lastError = "";
    const angelStatus = angelChromeProvider.status?.();
    const chromeStatus = chromeExistingSessionProvider.status?.();
    return {
      success: true,
      connected,
      provider_id: providerId,
      implementation: "desktop-browser-router",
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      providers: {
        angel: angelStatus,
        user: chromeStatus,
      },
      status: "connected",
      visible: typeof nextVisible === "boolean" ? nextVisible : visible,
      next_actions: ["browser tools are available through the shared provider runtime; default route is profile=angel"],
    };
  }

  function disconnect() {
    connected = false;
    closeAll();
    angelChromeProvider.disconnect?.();
    chromeExistingSessionProvider.disconnect?.();
    sessionRoutes.clear();
    return {
      success: true,
      connected,
      provider_id: providerId,
      implementation: "desktop-browser-router",
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      status: "disconnected",
      closed_session_count: 0,
      next_actions: ["call browser_connect to re-enable browser tools"],
    };
  }

  function cleanup({ sessionKey } = {}) {
    const before = sessions.size;
    if (typeof sessionKey === "string" && sessionKey.trim().length > 0) {
      const normalizedSessionId = normalizeSessionId(sessionKey);
      const session = sessions.get(normalizedSessionId);
      if (session) {
        closeWindow(session.window);
        sessions.delete(session.id);
      }
      angelChromeProvider.cleanup?.({ sessionKey });
      chromeExistingSessionProvider.cleanup?.({ sessionKey });
      sessionRoutes.delete(normalizedSessionId);
    } else {
      closeAll();
      angelChromeProvider.cleanup?.();
      chromeExistingSessionProvider.cleanup?.();
      sessionRoutes.clear();
    }
    const angelStatus = angelChromeProvider.status?.();
    const chromeStatus = chromeExistingSessionProvider.status?.();
    return {
      success: true,
      connected,
      provider_id: providerId,
      implementation: "desktop-browser-router",
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      status: connected ? "connected" : "disconnected",
      closed_session_count:
        Math.max(0, before - sessions.size) +
        Number(angelStatus?.last_closed_count ?? 0) +
        Number(chromeStatus?.last_closed_count ?? 0),
      session_count:
        sessions.size +
        Number(angelStatus?.session_count ?? 0) +
        Number(chromeStatus?.session_count ?? 0),
      sessions: [...listSessions(), ...(angelStatus?.sessions ?? []), ...(chromeStatus?.sessions ?? [])],
    };
  }

  function getOrCreateSession({ turnId, sessionKey }) {
    cleanupExpiredSessions();
    const id = normalizeSessionId(sessionKey);
    const existing = sessions.get(id);
    if (existing && !isWindowDestroyed(existing.window)) {
      touchSession(existing);
      return existing;
    }
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 880,
      minHeight: 640,
      title: "Director Angel 浏览器工具",
      show: visible,
      skipTaskbar: visible !== true,
      backgroundColor: "#f4f6f8",
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.directorAngelWindowRole = BROWSER_TOOL_WINDOW_ROLE;
    window.setTitle?.("Director Angel 浏览器工具");
    const consoleMessages = [];
    attachBrowserConsoleBuffer(window, consoleMessages);
    const session = {
      id,
      turnId,
      sessionKey,
      window,
      consoleMessages,
      lastUsedAtMs: nowMs(),
      lastSnapshot: null,
    };
    sessions.set(id, session);
    return session;
  }

  function getExistingSession({ turnId, sessionKey }) {
    cleanupExpiredSessions();
    const session = sessions.get(normalizeSessionId(sessionKey));
    if (!session || isWindowDestroyed(session.window)) {
      return null;
    }
    session.turnId = turnId;
    touchSession(session);
    return session;
  }

  function touchSession(session) {
    session.lastUsedAtMs = nowMs();
  }

  function getSessionRoute(sessionKey) {
    return sessionRoutes.get(normalizeSessionId(sessionKey)) ?? "angel";
  }

  function listSessions() {
    return [...sessions.values()].map((session) => ({
      id: session.id,
      sessionKey: session.sessionKey,
      turnId: session.turnId,
      lastUsedAtMs: session.lastUsedAtMs,
      url: session.lastSnapshot?.url ?? "",
      title: session.lastSnapshot?.title ?? "",
      destroyed: isWindowDestroyed(session.window),
    }));
  }

  function cleanupExpiredSessions() {
    const cutoff = nowMs() - sessionTtlMs;
    for (const [id, session] of sessions.entries()) {
      if (session.lastUsedAtMs >= cutoff && !isWindowDestroyed(session.window)) {
        continue;
      }
      closeWindow(session.window);
      sessions.delete(id);
    }
  }

  function closeAll() {
    for (const session of sessions.values()) {
      closeWindow(session.window);
    }
    sessions.clear();
  }

  return {
    navigate,
    snapshot,
    click,
    type,
    scroll,
    back,
    press,
    getImages,
    console: consoleTool,
    status,
    connect,
    disconnect,
    cleanup,
    closeAll,
    _sessions: sessions,
  };
}

function createBrowserProviderUnavailableResult(error) {
  return {
    success: false,
    error,
    metadata: {
      provider_status: "disconnected",
      next_actions: ["call browser_connect or enable the Browser provider"],
    },
  };
}

function createUnsupportedBrowserProfileResult(requestedProfile) {
  return {
    success: false,
    error: `Unsupported browser profile: ${requestedProfile || "(empty)"}.`,
    metadata: {
      provider_status: "unsupported-profile",
      requested_profile: requestedProfile,
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      next_actions: [
        "公开网页和动态站点使用 profile=angel 的受控 Browser Bridge/CDP 会话",
        "只有用户明确要求真实 Chrome/谷歌浏览器登录态时才使用 user profile",
        "Electron profile 已移除，不能用内置窗口冒充外部网页读取",
      ],
    },
  };
}

function createBlockedElectronProfileResult() {
  return {
    success: false,
    error: ELECTRON_PROFILE_BLOCKED_MESSAGE,
    metadata: {
      provider_status: "blocked",
      requested_profile: "electron",
      provider_id: DEFAULT_PROVIDER_ID,
      reason: "electron-profile-blocked",
      supported_profiles: SUPPORTED_BROWSER_PROFILES,
      next_actions: [
        "使用 browser_navigate profile=angel",
        "需要真实 Chrome 登录态时，明确使用 profile=user 并先连接 Chrome CDP",
      ],
    },
  };
}

function createChromeExistingSessionUnavailableResult({
  providerId,
  requestedProfile,
  cdpUrl,
  detail,
  cdpControl,
  security,
  capabilities,
  unavailableMessage,
  setupNextActions,
}) {
  return {
    success: false,
    error:
      unavailableMessage ??
      "用户明确要求使用真实 Google Chrome 登录态，但当前没有连接可用的 Chrome DevTools/CDP 会话。请先用带远程调试端口的 Chrome 启动并连接后再读这个页面。",
    metadata: {
      provider_id: providerId,
      provider_status: "unavailable",
      requested_profile: requestedProfile,
      required_provider_id: providerId,
      implementation: "chrome-devtools-protocol-existing-session-provider",
      cdp_url: redactChromeCdpUrl(cdpUrl),
      detail,
      capabilities: capabilities ?? createChromeCdpProviderCapabilities({ mode: "local-existing-session" }),
      cdp_control:
        cdpControl ??
        createChromeCdpControlStatus({
          cdpUrl,
          discovered: null,
          cdpHttp: false,
          cdpReady: false,
          error: detail,
        }),
      security: security ?? createChromeCdpSecurityStatus(cdpUrl, { allowRemoteCdp: false }),
      next_actions: setupNextActions ?? [
        "复用已经连接的 Browser Bridge/CDP 会话",
        "如果只需要普通公开网页读取，优先使用声明式网页读取工具",
        "没有可信正文时返回失败，不要用新浏览器窗口兜底",
      ],
    },
  };
}

function createChromeCdpProviderCapabilities({ mode }) {
  return {
    mode,
    is_remote: false,
    uses_chrome_cdp: true,
    uses_persistent_electron: false,
    supports_per_tab_ws: false,
    supports_json_tab_endpoints: true,
    supports_existing_session: mode === "local-existing-session",
    supports_managed_launch: mode === "local-managed-profile",
    supports_reset: mode === "local-managed-profile",
    supports_managed_tab_limit: false,
    supports_persistent_profile_mutation: mode === "local-managed-profile",
  };
}

export async function launchAngelManagedChrome({
  cdpUrl,
  userDataDir,
  spawnImpl = spawn,
  allowManagedLaunch = process.env.DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH === "1",
} = {}) {
  const parsed = parseUrlSafe(normalizeChromeCdpUrl(cdpUrl));
  const port = parsed?.port || "9223";
  const executable = resolveChromiumExecutable();
  const normalizedUserDataDir = String(userDataDir || DEFAULT_ANGEL_CHROME_USER_DATA_DIR);
  if (!allowManagedLaunch) {
    return {
      launched: false,
      status: "launch-blocked",
      profile: "angel",
      user_data_dir: normalizedUserDataDir,
      cdp_url: redactChromeCdpUrl(cdpUrl),
      error: MANAGED_CHROME_LAUNCH_BLOCKED_MESSAGE,
      next_actions: [
        "复用已连接的 Browser Bridge/CDP 会话",
        "只有显式设置 DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH=1 时才允许手动恢复 managed browser",
      ],
    };
  }
  if (executable === null) {
    return {
      launched: false,
      status: "missing-browser",
      profile: "angel",
      user_data_dir: normalizedUserDataDir,
      cdp_url: redactChromeCdpUrl(cdpUrl),
      error: "No Chromium-based browser executable was found.",
      next_actions: ["安装 Google Chrome、Chromium、Brave 或 Edge 后再启动 Angel Chrome"],
    };
  }
  mkdirSync(normalizedUserDataDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${normalizedUserDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--window-position=-32000,-32000",
    "--start-minimized",
    "about:blank",
  ];
  try {
    const child = spawnImpl(executable, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref?.();
    return {
      launched: true,
      status: "launch-requested",
      profile: "angel",
      pid: child.pid ?? null,
      executable,
      user_data_dir: normalizedUserDataDir,
      cdp_url: redactChromeCdpUrl(cdpUrl),
      next_actions: [`等待 Chrome CDP 在 ${redactChromeCdpUrl(cdpUrl)} 就绪后继续`],
    };
  } catch (error) {
    return {
      launched: false,
      status: "launch-failed",
      profile: "angel",
      executable,
      user_data_dir: normalizedUserDataDir,
      cdp_url: redactChromeCdpUrl(cdpUrl),
      error: toErrorMessage(error),
      next_actions: ["检查 Chrome 可执行文件和 user-data-dir 权限后重试"],
    };
  }
}

function resolveChromiumExecutable() {
  if (process.platform === "darwin") {
    return DARWIN_CHROMIUM_EXECUTABLES.find((candidate) => existsSync(candidate)) ?? null;
  }
  const candidates =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "brave-browser", "microsoft-edge"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
    const fromPath = findExecutableOnPath(candidate);
    if (fromPath !== null) {
      return fromPath;
    }
  }
  return null;
}

function findExecutableOnPath(name) {
  const paths = String(process.env.PATH ?? "")
    .split(pathDelimiter)
    .filter(Boolean);
  for (const entry of paths) {
    const candidate = join(entry, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function createChromeCdpControlStatus({ cdpUrl, discovered, cdpHttp, cdpReady, error }) {
  const targetCount = Array.isArray(discovered?.targets) ? discovered.targets.length : 0;
  return {
    cdp_http: Boolean(cdpHttp),
    cdp_ready: Boolean(cdpReady),
    cdp_url: redactChromeCdpUrl(cdpUrl),
    browser: typeof discovered?.browser === "string" ? discovered.browser : "",
    target_count: targetCount,
    browser_websocket_url: redactChromeCdpUrl(discovered?.browserWebSocketUrl ?? ""),
    last_error: typeof error === "string" ? error : "",
  };
}

function createChromeCdpSecurityStatus(cdpUrl, { allowRemoteCdp }) {
  const parsed = parseUrlSafe(normalizeChromeCdpUrl(cdpUrl));
  const loopback = parsed !== null && isLoopbackHostname(parsed.hostname);
  const remote = parsed !== null && !loopback;
  const warnings = [];
  if (remote && !allowRemoteCdp) {
    warnings.push("远程 Chrome CDP 默认禁止，避免把真实浏览器登录态暴露给网络地址。");
  } else if (remote) {
    warnings.push("远程 Chrome CDP 已显式允许，请确认这是可信控制面。");
  }
  return {
    cdp_url_policy: remote ? (allowRemoteCdp ? "remote-cdp-allowed" : "remote-cdp-blocked") : "loopback-control-plane",
    is_remote: remote,
    allow_remote_cdp: Boolean(allowRemoteCdp),
    warnings,
  };
}

function chromeCdpMissingSessionResult({ providerId = CHROME_PROVIDER_ID, profile = "user" } = {}) {
  return {
    success: false,
    error: `No Chrome browser session exists. Call browser_navigate with profile=${profile} first.`,
    metadata: {
      provider_id: providerId,
      profile,
    },
  };
}

async function captureSnapshot(session, { full, maxSnapshotChars, operationTimeoutMs }) {
  const result = normalizeSnapshotResult(
    await withTimeout(
      session.window.webContents.executeJavaScript(createBrowserSnapshotScript({ full }), true),
      operationTimeoutMs,
      "browser_snapshot timed out.",
    ),
  );
  const clipped = clipSnapshotText(result.text, maxSnapshotChars);
  return {
    ...result,
    text: clipped.text,
    truncated: clipped.truncated,
  };
}

async function captureChromeCdpSnapshot(page, { full, maxSnapshotChars, operationTimeoutMs }) {
  const result = normalizeSnapshotResult(
    await withTimeout(
      chromeCdpEvaluate(page, createBrowserSnapshotScript({ full })),
      operationTimeoutMs,
      "chrome browser_snapshot timed out.",
    ),
  );
  const clipped = clipSnapshotText(result.text, maxSnapshotChars);
  return {
    ...result,
    text: clipped.text,
    truncated: clipped.truncated,
  };
}

async function runElementScript(window, ref, action, text = "", operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await withTimeout(
    window.webContents.executeJavaScript(
      createBrowserElementActionScript({
        ref,
        action,
        text,
      }),
      true,
    ),
    operationTimeoutMs,
    `browser_${action} timed out for ${ref}`,
  );
}

async function discoverChromeCdpEndpoint({ cdpUrl, fetchImpl, timeoutMs, allowRemoteCdp = false }) {
  const normalized = normalizeChromeCdpUrl(cdpUrl);
  assertChromeCdpControlAllowed(normalized, { allowRemoteCdp });
  if (isConcreteChromeCdpWebSocketUrl(normalized)) {
    return {
      browser: "Chrome CDP",
      browserWebSocketUrl: normalized,
      targetId: "",
      webSocketDebuggerUrl: normalized,
      targets: [],
    };
  }
  const root = normalized.replace(/\/(?:json(?:\/version|\/list)?|devtools\/browser\/.*)?$/u, "");
  const versionUrl = `${root}/json/version`;
  const listUrl = `${root}/json`;
  let browser = "Chrome CDP";
  let browserWebSocketUrl = "";
  try {
    const version = await fetchJsonWithTimeout(fetchImpl, versionUrl, timeoutMs);
    browser = typeof version.Browser === "string" ? version.Browser : browser;
    browserWebSocketUrl =
      typeof version.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : "";
  } catch {
    // Some CDP-compatible endpoints expose /json but not /json/version.
  }
  const targets = await fetchJsonWithTimeout(fetchImpl, listUrl, timeoutMs);
  const targetList = Array.isArray(targets) ? targets : [];
  const page =
    targetList.find((target) => target?.type === "page" && typeof target.webSocketDebuggerUrl === "string") ??
    targetList.find((target) => typeof target?.webSocketDebuggerUrl === "string");
  if (!page) {
    throw new Error(`Chrome CDP endpoint ${root} did not expose a page target.`);
  }
  return {
    browser,
    browserWebSocketUrl,
    targetId: typeof page.id === "string" ? page.id : "",
    webSocketDebuggerUrl: page.webSocketDebuggerUrl,
    targets: targetList,
  };
}

async function waitForChromeCdpEndpoint({
  cdpUrl,
  fetchImpl,
  discoveryTimeoutMs,
  readyTimeoutMs,
  pollMs,
  allowRemoteCdp = false,
}) {
  const startedAt = Date.now();
  let lastError = null;
  const maxWaitMs =
    Number.isFinite(readyTimeoutMs) && readyTimeoutMs > 0
      ? readyTimeoutMs
      : discoveryTimeoutMs;
  const waitMs =
    Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_CDP_LAUNCH_READY_POLL_MS;
  while (Date.now() - startedAt <= maxWaitMs) {
    try {
      return await discoverChromeCdpEndpoint({
        cdpUrl,
        fetchImpl,
        timeoutMs: discoveryTimeoutMs,
        allowRemoteCdp,
      });
    } catch (error) {
      lastError = error;
      if (Date.now() - startedAt >= maxWaitMs) {
        break;
      }
      await delay(Math.min(waitMs, Math.max(0, maxWaitMs - (Date.now() - startedAt))));
    }
  }
  throw lastError ?? new Error("Chrome CDP endpoint did not become ready.");
}

async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable for Chrome CDP discovery.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response?.ok) {
      throw new Error(`HTTP ${response?.status ?? "unknown"}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function connectChromeCdpPage({
  id,
  turnId,
  sessionKey,
  targetId,
  webSocketDebuggerUrl,
  WebSocketImpl,
  operationTimeoutMs,
  nowMs,
}) {
  if (typeof WebSocketImpl !== "function") {
    throw new Error("WebSocket is unavailable for Chrome CDP.");
  }
  const socket = new WebSocketImpl(webSocketDebuggerUrl);
  const pending = new Map();
  const consoleMessages = [];
  let nextId = 1;
  const page = {
    id,
    turnId,
    sessionKey,
    targetId,
    socket,
    consoleMessages,
    lastUsedAtMs: nowMs(),
    lastSnapshot: null,
    call(method, params = {}) {
      if (socket.readyState !== WebSocketImpl.OPEN) {
        return Promise.reject(new Error("Chrome CDP socket is not open."));
      }
      const messageId = nextId++;
      const payload = JSON.stringify({ id: messageId, method, params });
      return withTimeout(
        new Promise((resolve, reject) => {
          pending.set(messageId, { resolve, reject });
          socket.send(payload);
        }),
        operationTimeoutMs,
        `Chrome CDP ${method} timed out after ${operationTimeoutMs}ms.`,
      );
    },
  };
  await waitForWebSocketOpen(socket, WebSocketImpl, operationTimeoutMs);
  socket.addEventListener?.("message", (event) => {
    handleChromeCdpMessage(page, pending, event.data);
  });
  socket.addEventListener?.("close", () => {
    rejectAllChromeCdpPending(pending, new Error("Chrome CDP socket closed."));
  });
  socket.addEventListener?.("error", () => {
    rejectAllChromeCdpPending(pending, new Error("Chrome CDP socket error."));
  });
  return page;
}

function waitForWebSocketOpen(socket, WebSocketImpl, timeoutMs) {
  if (socket.readyState === WebSocketImpl.OPEN) {
    return Promise.resolve();
  }
  return withTimeout(
    new Promise((resolve, reject) => {
      socket.addEventListener?.("open", resolve, { once: true });
      socket.addEventListener?.("error", () => reject(new Error("Chrome CDP socket error.")), {
        once: true,
      });
    }),
    timeoutMs,
    `Chrome CDP socket did not open after ${timeoutMs}ms.`,
  );
}

function handleChromeCdpMessage(page, pending, data) {
  let message;
  try {
    message = JSON.parse(String(data));
  } catch {
    return;
  }
  if (typeof message.id === "number") {
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(new Error(`Chrome CDP error: ${JSON.stringify(message.error)}`));
      return;
    }
    entry.resolve(message.result ?? {});
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const args = Array.isArray(message.params?.args) ? message.params.args : [];
    page.consoleMessages.push({
      level: typeof message.params?.type === "string" ? message.params.type : "log",
      text: args
        .map((arg) =>
          typeof arg?.value === "string" ? arg.value : typeof arg?.description === "string" ? arg.description : "",
        )
        .filter(Boolean)
        .join(" "),
      timestamp: new Date().toISOString(),
      source: "chrome-cdp",
    });
    if (page.consoleMessages.length > 200) {
      page.consoleMessages.splice(0, page.consoleMessages.length - 200);
    }
  }
}

function rejectAllChromeCdpPending(pending, error) {
  for (const entry of pending.values()) {
    entry.reject(error);
  }
  pending.clear();
}

async function chromeCdpEvaluate(page, expression) {
  const result = await page.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(`Chrome evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitForChromeCdpSettled(page, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 5_000);
  while (Date.now() < deadline) {
    try {
      const state = await chromeCdpEvaluate(page, "document.readyState");
      if (state === "complete" || state === "interactive") {
        return;
      }
    } catch {
      return;
    }
    await delay(150);
  }
}

function closeCdpSession(session) {
  try {
    session.socket?.close?.();
  } catch {
    // Best-effort cleanup only.
  }
}

function normalizeSnapshotResult(value) {
  if (!value || typeof value !== "object") {
    return {
      url: "",
      title: "",
      text: "",
      elements: [],
    };
  }
  const elements = Array.isArray(value.elements)
    ? value.elements
        .map((item) => ({
          ref: typeof item?.ref === "string" ? item.ref : "",
          role: typeof item?.role === "string" ? item.role : "element",
          name: typeof item?.name === "string" ? item.name : "",
          selector: typeof item?.selector === "string" ? item.selector : "",
        }))
        .filter((item) => item.ref.length > 0)
    : [];
  return {
    url: typeof value.url === "string" ? value.url : "",
    title: typeof value.title === "string" ? value.title : "",
    text: typeof value.text === "string" ? value.text : "",
    elements,
  };
}

function getElementByRef(session, ref) {
  const normalizedRef = ref.startsWith("@") ? ref : `@${ref}`;
  return session.lastSnapshot?.elements?.find((element) => element.ref === normalizedRef) ?? null;
}

function createBrowserSnapshotScript({ full }) {
  return `(() => {
    const cleanText = (value) => String(value || '')
      .replace(/\\r\\n?/g, '\\n')
      .split('\\n')
      .map((line) => line.replace(/[ \\t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
    };
    const roleFor = (element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'input') return element.type === 'submit' || element.type === 'button' ? 'button' : 'textbox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      return tag;
    };
    const nameFor = (element) => cleanText(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.getAttribute('placeholder') ||
      element.innerText ||
      element.value ||
      element.textContent ||
      ''
    ).slice(0, 160);
    const selectorFor = (element, index) => {
      element.setAttribute('data-director-browser-ref', String(index + 1));
      return '[data-director-browser-ref="' + String(index + 1) + '"]';
    };
    const candidates = Array.from(document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"]'))
      .filter(isVisible)
      .slice(0, 120);
    const elements = candidates.map((element, index) => ({
      ref: '@e' + String(index + 1),
      role: roleFor(element),
      name: nameFor(element),
      selector: selectorFor(element, index)
    }));
    const root = document.querySelector('main, article, [role="main"], #js_content, .rich_media_content') || document.body || document.documentElement;
    const text = ${full ? "cleanText(root ? (root.innerText || root.textContent || '') : '')" : "elements.map((item) => '[' + item.ref + '] ' + item.role + ' ' + item.name).join('\\n')"};
    return {
      url: location.href,
      title: document.title || '',
      text,
      elements
    };
  })()`;
}

function createBrowserElementActionScript({ ref, action, text }) {
  return `(() => {
    const target = document.querySelector('[data-director-browser-ref="${escapeScriptString(ref.replace(/^@e/u, ""))}"]');
    if (!target) {
      throw new Error('Unknown browser ref ${escapeScriptString(ref)}');
    }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    if (${JSON.stringify(action)} === 'click') {
      target.click();
      return true;
    }
    if (${JSON.stringify(action)} === 'type') {
      target.focus();
      const value = ${JSON.stringify(text)};
      if ('value' in target) {
        target.value = '';
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        target.textContent = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }
    throw new Error('Unsupported browser action');
  })()`;
}

function createBrowserScrollScript({ direction, pages }) {
  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  return `(() => {
    const pages = ${JSON.stringify(pages)};
    const distance = (${axis === "x" ? "window.innerWidth" : "window.innerHeight"} || 800) * pages * ${sign};
    window.scrollBy({ ${axis === "x" ? "left" : "top"}: distance, behavior: 'instant' });
    return { x: window.scrollX, y: window.scrollY };
  })()`;
}

function createBrowserPressScript({ key }) {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const target = document.activeElement || document.body || document.documentElement;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
    }
    return true;
  })()`;
}

function createBrowserGetImagesScript() {
  return `(() => {
    const resolveUrl = (value) => {
      try { return value ? new URL(value, location.href).href : ''; } catch { return String(value || ''); }
    };
    const seen = new Set();
    const push = (items, item) => {
      const src = resolveUrl(item.src);
      if (!src || seen.has(src)) return;
      seen.add(src);
      items.push({ ...item, src });
    };
    const items = [];
    for (const img of Array.from(document.images || [])) {
      const rect = img.getBoundingClientRect();
      push(items, {
        src: img.currentSrc || img.src || '',
        alt: img.alt || img.getAttribute('aria-label') || '',
        title: img.title || '',
        width: Number(img.naturalWidth || rect.width || 0),
        height: Number(img.naturalHeight || rect.height || 0),
        visible: rect.width > 1 && rect.height > 1 && getComputedStyle(img).visibility !== 'hidden'
      });
    }
    for (const source of Array.from(document.querySelectorAll('picture source[srcset], source[srcset]'))) {
      const srcset = source.getAttribute('srcset') || '';
      const src = srcset.split(',')[0]?.trim().split(/\\s+/)[0] || '';
      push(items, {
        src,
        alt: '',
        title: '',
        width: 0,
        height: 0,
        visible: false
      });
    }
    for (const element of Array.from(document.querySelectorAll('*')).slice(0, 600)) {
      const bg = getComputedStyle(element).backgroundImage || '';
      const match = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (!match) continue;
      const rect = element.getBoundingClientRect();
      push(items, {
        src: match[1],
        alt: element.getAttribute('aria-label') || '',
        title: element.getAttribute('title') || '',
        width: Number(rect.width || 0),
        height: Number(rect.height || 0),
        visible: rect.width > 1 && rect.height > 1
      });
    }
    return items.slice(0, 200);
  })()`;
}

function createBrowserConsoleExpressionScript(expression) {
  return `(() => {
    const value = (() => (${expression}))();
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  })()`;
}

function attachBrowserConsoleBuffer(window, consoleMessages) {
  if (typeof window.webContents?.on !== "function") {
    return;
  }
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    consoleMessages.push({
      level: normalizeConsoleLevel(level),
      text: String(message ?? ""),
      source: String(sourceId ?? ""),
      line: typeof line === "number" ? line : 0,
      timestamp: new Date().toISOString(),
    });
    if (consoleMessages.length > 200) {
      consoleMessages.splice(0, consoleMessages.length - 200);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    consoleMessages.push({
      level: "error",
      text: `render-process-gone: ${JSON.stringify(details ?? {})}`,
      timestamp: new Date().toISOString(),
    });
  });
}

async function handleDesktopBrowserToolRequest(
  request,
  response,
  { browserToolService, path, requestTimeoutMs },
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== path) {
    writeJsonResponse(response, 404, {
      error: "not-found",
      message: "Desktop browser tool server only serves /tool.",
    });
    return;
  }
  if (request.method !== "POST") {
    writeJsonResponse(response, 405, {
      error: "method-not-allowed",
      message: "Desktop browser tool server requires POST.",
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request, MAX_TOOL_SERVER_REQUEST_BYTES));
  } catch (error) {
    writeJsonResponse(response, 400, {
      error: "invalid-json",
      message: `Invalid browser tool request JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const toolName = typeof payload?.toolName === "string" ? payload.toolName.trim() : "";
  const methodName = BROWSER_TOOL_METHODS[toolName];
  if (typeof methodName !== "string") {
    writeJsonResponse(response, 400, {
      error: "invalid-tool",
      message: `Unsupported desktop browser tool: ${toolName || "(missing)"}.`,
    });
    return;
  }
  const method = browserToolService[methodName];
  if (typeof method !== "function") {
    writeJsonResponse(response, 503, {
      error: "tool-unavailable",
      message: `Desktop browser provider does not implement ${toolName}.`,
    });
    return;
  }

  const turnId = normalizeBridgeString(payload?.turnId, "desktop-browser-tool");
  const sessionKey = normalizeBridgeString(payload?.sessionKey, "desktop");
  const args = typeof payload?.args === "object" && payload.args !== null ? payload.args : {};
  try {
    const result = await withTimeout(
      Promise.resolve(method.call(browserToolService, { ...args, turnId, sessionKey })),
      requestTimeoutMs,
      `Desktop browser tool ${toolName} timed out after ${requestTimeoutMs}ms.`,
    );
    writeJsonResponse(response, 200, normalizeBrowserToolBridgeResult(result));
  } catch (error) {
    const message = toErrorMessage(error);
    const cleanup = isBrowserToolTimeoutError(message)
      ? await cleanupDesktopBrowserToolSessionAfterTimeout({
          browserToolService,
          sessionKey,
          requestTimeoutMs,
        })
      : null;
    writeJsonResponse(response, 502, {
      success: false,
      error: "tool-failed",
      message,
      ...(cleanup === null ? {} : { cleanup }),
    });
  }
}

async function cleanupDesktopBrowserToolSessionAfterTimeout({
  browserToolService,
  sessionKey,
  requestTimeoutMs,
}) {
  if (typeof browserToolService.cleanup !== "function") {
    return {
      success: false,
      error: "cleanup-unavailable",
      sessionKey,
    };
  }
  const cleanupTimeoutMs = Math.min(Math.max(Number(requestTimeoutMs) || 0, 100), 5_000);
  try {
    return normalizeBrowserToolBridgeResult(
      await withTimeout(
        Promise.resolve(browserToolService.cleanup({ sessionKey })),
        cleanupTimeoutMs,
        `Desktop browser cleanup timed out after ${cleanupTimeoutMs}ms.`,
      ),
    );
  } catch (cleanupError) {
    return {
      success: false,
      error: "cleanup-failed",
      message: toErrorMessage(cleanupError),
      sessionKey,
    };
  }
}

function isBrowserToolTimeoutError(message) {
  return /\btime(?:d)?\s*out\b|timeout/iu.test(String(message ?? ""));
}

function normalizeBridgeString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeBrowserProfile(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function isSupportedBrowserProfile(profile) {
  return profile.length === 0 || SUPPORTED_BROWSER_PROFILES.includes(profile);
}

function normalizeChromeCdpUrl(value) {
  const raw = String(value ?? "").trim() || DEFAULT_CHROME_CDP_URL;
  if (/^(?:https?|wss?):\/\//iu.test(raw)) {
    return raw.replace(/\/$/u, "");
  }
  return `http://${raw}`.replace(/\/$/u, "");
}

function isConcreteChromeCdpWebSocketUrl(value) {
  return /^wss?:\/\//iu.test(value) && /\/devtools\/(?:browser|page)\//iu.test(value);
}

function redactChromeCdpUrl(value) {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) {
    return "";
  }
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString();
  } catch {
    return raw.replace(/\/\/[^@\s]+@/u, "//");
  }
}

function assertChromeCdpControlAllowed(cdpUrl, { allowRemoteCdp }) {
  const parsed = parseUrlSafe(normalizeChromeCdpUrl(cdpUrl));
  if (parsed === null || isLoopbackHostname(parsed.hostname) || allowRemoteCdp) {
    return;
  }
  throw new Error("Remote Chrome CDP endpoints are blocked unless allowRemoteCdp is enabled.");
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function normalizeBrowserToolBridgeResult(result) {
  if (typeof result !== "object" || result === null) {
    return {
      success: false,
      error: "Desktop browser tool returned an invalid result.",
    };
  }
  return result;
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        rejectRead(new Error("Browser tool request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolveRead(body));
    request.on("error", rejectRead);
  });
}

function writeJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function clipSnapshotText(value, maxChars) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n[truncated]`,
    truncated: true,
  };
}

function normalizeSessionId(sessionKey) {
  return String(sessionKey ?? "default").replace(/[^a-z0-9._:-]/giu, "-").slice(0, 120) || "default";
}

function assertBrowserToolUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Browser tool URL is invalid: ${value}`);
  }
  if (url.href !== "about:blank" && url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser tool URL must use http/https or about:blank.");
  }
}

function assertBrowserNavigationAllowed(value, { allowPrivateUrls }) {
  if (value === "about:blank") {
    return;
  }
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (!allowPrivateUrls && DEFAULT_BLOCKED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Browser navigation blocked by provider policy for private/local host: ${hostname}.`,
    );
  }
}

function normalizeScrollDirection(value) {
  return value === "up" || value === "down" || value === "left" || value === "right"
    ? value
    : null;
}

function normalizeScrollPages(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 1;
  }
  return Math.min(number, 20);
}

function normalizeKeyCode(value) {
  return String(value ?? "").trim().slice(0, 80);
}

function normalizeBrowserImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      src: typeof item?.src === "string" ? item.src : "",
      alt: typeof item?.alt === "string" ? item.alt : "",
      title: typeof item?.title === "string" ? item.title : "",
      width: Number.isFinite(item?.width) ? Number(item.width) : 0,
      height: Number.isFinite(item?.height) ? Number(item.height) : 0,
      metadata: {
        visible: item?.visible === true,
      },
    }))
    .filter((item) => item.src.length > 0);
}

function normalizeConsoleLevel(level) {
  if (typeof level === "string") {
    return level;
  }
  if (level === 0) {
    return "verbose";
  }
  if (level === 1) {
    return "info";
  }
  if (level === 2) {
    return "warning";
  }
  if (level === 3) {
    return "error";
  }
  return "log";
}

function isWindowDestroyed(window) {
  return typeof window.isDestroyed === "function" && window.isDestroyed();
}

function closeWindow(window) {
  if (!isWindowDestroyed(window)) {
    window.close?.();
  }
}

function escapeScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function waitForBrowserSettled(window, timeoutMs) {
  if (typeof window.webContents?.once !== "function") {
    return delay(250);
  }
  return withTimeout(
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 250);
      window.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
      window.webContents.once("did-navigate", () => {
        clearTimeout(timer);
        resolve();
      });
    }),
    Math.min(timeoutMs, 3_000),
    "browser navigation settle timed out.",
  ).catch(() => undefined);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeout = null;
  return Promise.race([
    promise.finally(() => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    }),
    new Promise((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]);
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
