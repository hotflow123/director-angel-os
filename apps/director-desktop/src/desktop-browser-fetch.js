import { createServer } from "node:http";

const DEFAULT_MIN_TEXT_CHARS = 80;
const LEARNING_USER_AGENT = "DirectorAngelDesktopLearning/0.1";
const DEFAULT_EXTRACTOR_HOST = "127.0.0.1";
const DEFAULT_EXTRACTOR_PATH = "/extract";
const DEFAULT_EXTRACTOR_REQUEST_TIMEOUT_MS = 25_000;
const MAX_EXTRACTOR_REQUEST_BYTES = 64 * 1024;

export function createDesktopBrowserLearningFetchText({
  BrowserWindow,
  fetchImpl = globalThis.fetch,
  minTextChars = DEFAULT_MIN_TEXT_CHARS,
} = {}) {
  if (typeof BrowserWindow !== "function") {
    throw new Error("Desktop browser learning requires Electron BrowserWindow.");
  }

  return async function desktopBrowserLearningFetchText(url) {
    assertHttpUrl(url);
    const initial = await fetchWithStandardFetch(url, fetchImpl);
    if (initial !== null && !shouldUseBrowserLearningWindow(initial, { minTextChars })) {
      return initial;
    }
    throw createElectronLearningWindowBlockedError(url, initial);
  };
}

export function createBlockedDesktopBrowserLearningWindowOptions(options = {}) {
  return {
    partition: options.partition,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function createElectronLearningWindowBlockedError(url, initial) {
  const reason = initial === null ? "standard-fetch-unavailable" : "standard-fetch-insufficient";
  const status =
    initial !== null && Number.isFinite(Number(initial.status))
      ? ` HTTP ${Number(initial.status)}`
      : "";
  const bodyChars =
    initial !== null && typeof initial.body === "string"
      ? normalizeWhitespace(initial.body).length
      : 0;
  return new Error(
    [
      `Director Angel 已禁止用 Electron 学习窗口直接打开网页：${url}`,
      `原因：${reason}${status}，当前可信正文 ${bodyChars} 字。`,
      "请使用受控 OpenCLI / Browser Bridge 已连接会话读取；没有可信正文时必须失败关闭，不能打开空白浏览器或把媒体内容当结论。",
    ].join("\n"),
  );
}

export function createDesktopBrowserLearningFetchServer({
  fetchText,
  host = DEFAULT_EXTRACTOR_HOST,
  path = DEFAULT_EXTRACTOR_PATH,
  requestTimeoutMs = DEFAULT_EXTRACTOR_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchText !== "function") {
    throw new Error("Desktop browser learning fetch server requires fetchText.");
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
        void handleLearningFetchRequest(request, response, {
          fetchText,
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

export function shouldUseBrowserLearningWindow(
  { url, status = 200, body, contentType },
  { minTextChars = DEFAULT_MIN_TEXT_CHARS } = {},
) {
  if (status === 401 || status === 403) {
    return true;
  }
  if (isLikelyLoginUrl(url)) {
    return true;
  }

  const text = extractReadableText(body, contentType);
  if (isLikelyLoginText(text) && text.length < 1_000) {
    return true;
  }
  if (looksLikeRichLearningPage(body, contentType)) {
    return true;
  }
  if (text.length >= minTextChars) {
    return false;
  }

  return looksLikeHtml(body) && body.length > text.length * 4;
}

async function fetchWithStandardFetch(url, fetchImpl) {
  if (typeof fetchImpl !== "function") {
    return null;
  }
  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": LEARNING_USER_AGENT,
      },
    });
    const status = Number(response.status ?? 0);
    if (response.ok === false && status !== 401 && status !== 403) {
      throw new Error(`Web source fetch failed for ${url}: HTTP ${status}.`);
    }

    return {
      url: response.url || url,
      body: await response.text(),
      ...(getHeader(response.headers, "content-type") === undefined
        ? {}
        : { contentType: getHeader(response.headers, "content-type") }),
      status,
    };
  } catch {
    return null;
  }
}

async function handleLearningFetchRequest(
  request,
  response,
  { fetchText, path, requestTimeoutMs },
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== path) {
    writeJsonResponse(response, 404, {
      error: "not-found",
      message: "Desktop browser learning extractor only serves /extract.",
    });
    return;
  }
  if (request.method !== "POST") {
    writeJsonResponse(response, 405, {
      error: "method-not-allowed",
      message: "Desktop browser learning extractor requires POST.",
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch (error) {
    writeJsonResponse(response, 400, {
      error: "invalid-json",
      message: `Invalid extractor request JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const targetUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
  try {
    assertHttpUrl(targetUrl);
  } catch (error) {
    writeJsonResponse(response, 400, {
      error: "invalid-url",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const result = await withTimeout(
      fetchText(targetUrl),
      requestTimeoutMs,
      `Desktop browser learning extractor timed out after ${requestTimeoutMs}ms for ${targetUrl}.`,
    );
    writeJsonResponse(response, 200, normalizeLearningFetchBridgeResult(result, targetUrl));
  } catch (error) {
    writeJsonResponse(response, error instanceof TimeoutError ? 504 : 502, {
      error: "extract-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function readRequestBody(request) {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_EXTRACTOR_REQUEST_BYTES) {
        rejectRead(new Error("Extractor request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolveRead(body));
    request.on("error", rejectRead);
  });
}

function normalizeLearningFetchBridgeResult(result, fallbackUrl) {
  if (typeof result !== "object" || result === null) {
    throw new Error("Desktop browser extractor returned an invalid result.");
  }
  const body = typeof result.body === "string" ? result.body : "";
  if (body.length === 0) {
    throw new Error("Desktop browser extractor returned empty body.");
  }
  return {
    url: typeof result.url === "string" && result.url.trim().length > 0 ? result.url : fallbackUrl,
    body,
    ...(typeof result.contentType === "string" && result.contentType.trim().length > 0
      ? { contentType: result.contentType }
      : {}),
    ...(typeof result.structuredContent === "object" && result.structuredContent !== null
      ? { structuredContent: result.structuredContent }
      : {}),
  };
}

function writeJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function isLikelyLoginUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      host.startsWith("accounts.") ||
      host.includes(".accounts.") ||
      path.includes("login") ||
      path.includes("signin") ||
      path.includes("auth")
    );
  } catch {
    return false;
  }
}

function isLikelyLoginText(value) {
  return /登录|登入|扫码登录|sign\s+in|log\s+in|login required|continue with/iu.test(value);
}

function extractReadableText(body, contentType) {
  if (contentType?.includes("html") === false && !looksLikeHtml(body)) {
    return normalizeWhitespace(body);
  }
  return normalizeWhitespace(
    String(body ?? "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  );
}

function looksLikeRichLearningPage(body, contentType) {
  if (contentType?.includes("html") === false && !looksLikeHtml(body)) {
    return false;
  }
  return /<(table|img|picture|video|audio|iframe|source)\b/iu.test(String(body ?? ""));
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/iu.test(String(value ?? ""));
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getHeader(headers, name) {
  const value = headers?.get?.(name);
  return value === null || value === undefined ? undefined : String(value);
}

function assertHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Desktop browser learning URL is invalid: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Desktop browser learning URL must use http or https.");
  }
}

class TimeoutError extends Error {}

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
        reject(new TimeoutError(message));
      }, timeoutMs);
    }),
  ]);
}
