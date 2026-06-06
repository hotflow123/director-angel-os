import { randomBytes, randomUUID } from "node:crypto";

import type {
  FetchLike,
  WeixinGetUpdatesResponse,
  WeixinLoginCredentials,
  WeixinQrStartResponse,
  WeixinQrStatus,
  WeixinQrStatusResponse,
  WeixinSendMessageResponse,
} from "./types.js";

export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const DEFAULT_ILINK_BOT_TYPE = "3";
export const SESSION_EXPIRED_ERRCODE = -14;

const CHANNEL_VERSION = "0.1.0";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;
const API_TIMEOUT_MS = 15_000;
const QR_TIMEOUT_MS = 35_000;

function getFetch(fetchFn?: FetchLike): FetchLike {
  return fetchFn ?? ((url, init) => fetch(url, init));
}

function randomWechatUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

function baseInfo(): Record<string, string> {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: "DirectorAngel/0.1",
  };
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function postHeaders(token: string | undefined, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": randomWechatUin(),
    ...commonHeaders(),
    ...(token === undefined || token.trim().length === 0
      ? {}
      : { Authorization: `Bearer ${token.trim()}` }),
  };
}

function withTimeout(timeoutMs: number): { readonly signal: AbortSignal; cancel(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel(): void {
      clearTimeout(timer);
    },
  };
}

async function apiGet<T>(
  input: {
    readonly baseUrl: string;
    readonly endpoint: string;
    readonly timeoutMs?: number;
  },
  fetchFn?: FetchLike,
): Promise<T> {
  const timeout = withTimeout(input.timeoutMs ?? API_TIMEOUT_MS);
  try {
    const url = new URL(input.endpoint, `${input.baseUrl.replace(/\/+$/u, "")}/`);
    const response = await getFetch(fetchFn)(url.toString(), {
      method: "GET",
      headers: commonHeaders(),
      signal: timeout.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`iLink GET ${input.endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(raw) as T;
  } finally {
    timeout.cancel();
  }
}

async function apiPost<T>(
  input: {
    readonly baseUrl: string;
    readonly endpoint: string;
    readonly body: Record<string, unknown>;
    readonly token?: string;
    readonly timeoutMs?: number;
  },
  fetchFn?: FetchLike,
): Promise<T> {
  const body = JSON.stringify({ ...input.body, base_info: baseInfo() });
  const timeout = withTimeout(input.timeoutMs ?? API_TIMEOUT_MS);
  try {
    const url = new URL(input.endpoint, `${input.baseUrl.replace(/\/+$/u, "")}/`);
    const response = await getFetch(fetchFn)(url.toString(), {
      method: "POST",
      headers: postHeaders(input.token, body),
      body,
      signal: timeout.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`iLink POST ${input.endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(raw) as T;
  } finally {
    timeout.cancel();
  }
}

export async function startWeixinQrLogin(
  input: {
    readonly baseUrl?: string;
    readonly botType?: string;
    readonly localTokenList?: readonly string[];
  } = {},
  fetchFn?: FetchLike,
): Promise<{ readonly sessionKey: string; readonly qrcode: string; readonly qrcodeUrl: string }> {
  const botType = input.botType ?? DEFAULT_ILINK_BOT_TYPE;
  const response = await apiPost<WeixinQrStartResponse>(
    {
      baseUrl: input.baseUrl ?? ILINK_BASE_URL,
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      body: { local_token_list: [...(input.localTokenList ?? [])] },
      timeoutMs: QR_TIMEOUT_MS,
    },
    fetchFn,
  );
  const qrcode = response.qrcode?.trim() ?? "";
  const qrcodeUrl = response.qrcode_img_content?.trim() ?? qrcode;
  if (!qrcode || !qrcodeUrl) {
    throw new Error("iLink QR response missing qrcode.");
  }
  return {
    sessionKey: randomUUID(),
    qrcode,
    qrcodeUrl,
  };
}

export async function checkWeixinQrLoginStatus(
  input: {
    readonly qrcode: string;
    readonly baseUrl?: string;
    readonly verifyCode?: string;
  },
  fetchFn?: FetchLike,
): Promise<
  | {
      readonly status: Exclude<WeixinQrStatus, "confirmed">;
      readonly baseUrl: string;
      readonly redirectBaseUrl?: string;
      readonly message?: string;
    }
  | {
      readonly status: "confirmed";
      readonly baseUrl: string;
      readonly credentials: WeixinLoginCredentials;
    }
> {
  const currentBaseUrl = input.baseUrl ?? ILINK_BASE_URL;
  const verifyCode = input.verifyCode?.trim() ?? "";
  const suffix = verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : "";
  const status: WeixinQrStatusResponse = await apiGet<WeixinQrStatusResponse>(
    {
      baseUrl: currentBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(input.qrcode)}${suffix}`,
      timeoutMs: QR_TIMEOUT_MS,
    },
    fetchFn,
  ).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" } satisfies WeixinQrStatusResponse;
    }
    throw error;
  });

  if (status.status === "confirmed") {
    const accountId = status.ilink_bot_id?.trim() ?? "";
    const token = status.bot_token?.trim() ?? "";
    if (!accountId || !token) {
      throw new Error("微信已确认，但 iLink 未返回完整 accountId/token。");
    }
    return {
      status: "confirmed",
      baseUrl: status.baseurl?.trim() || currentBaseUrl,
      credentials: {
        accountId,
        token,
        baseUrl: status.baseurl?.trim() || currentBaseUrl,
        ...(status.ilink_user_id?.trim() ? { userId: status.ilink_user_id.trim() } : {}),
      },
    };
  }

  if (status.status === "scaned_but_redirect" && status.redirect_host?.trim()) {
    return {
      status: "scaned_but_redirect",
      baseUrl: currentBaseUrl,
      redirectBaseUrl: `https://${status.redirect_host.trim()}`,
    };
  }

  return {
    status: status.status ?? "wait",
    baseUrl: currentBaseUrl,
    ...(status.errmsg?.trim() ? { message: status.errmsg.trim() } : {}),
  };
}

export async function waitForWeixinQrLogin(
  input: {
    readonly qrcode: string;
    readonly baseUrl?: string;
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly onStatus?: (message: string) => void;
    readonly requestVerifyCode?: (message: string) => Promise<string>;
  },
  fetchFn?: FetchLike,
): Promise<WeixinLoginCredentials> {
  let currentBaseUrl = input.baseUrl ?? ILINK_BASE_URL;
  const deadline = Date.now() + (input.timeoutMs ?? 480_000);
  let pendingVerifyCode = "";
  while (Date.now() < deadline) {
    const status = await checkWeixinQrLoginStatus(
      {
        qrcode: input.qrcode,
        baseUrl: currentBaseUrl,
        ...(pendingVerifyCode ? { verifyCode: pendingVerifyCode } : {}),
      },
      fetchFn,
    );

    switch (status.status) {
      case "wait":
        input.onStatus?.(".");
        break;
      case "scaned":
        pendingVerifyCode = "";
        input.onStatus?.("\n已扫码，请在手机微信确认。\n");
        break;
      case "scaned_but_redirect":
        if (status.redirectBaseUrl?.trim()) {
          currentBaseUrl = status.redirectBaseUrl.trim();
        }
        break;
      case "need_verifycode":
        if (input.requestVerifyCode === undefined) {
          throw new Error("微信要求输入手机端数字验证码，但当前运行环境没有验证码输入器。");
        }
        pendingVerifyCode = await input.requestVerifyCode("输入手机微信显示的数字验证码：");
        break;
      case "verify_code_blocked":
        throw new Error("验证码多次错误，请稍后重新扫码。");
      case "expired":
        throw new Error("二维码已过期，请重新执行登录。");
      case "binded_redirect":
        throw new Error("此微信已连接过当前通道，无需重复连接。");
      case "confirmed": {
        return status.credentials;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 1000));
  }
  throw new Error("微信扫码登录超时。");
}

export async function getWeixinUpdates(
  input: {
    readonly baseUrl: string;
    readonly token: string;
    readonly syncBuf: string;
    readonly timeoutMs?: number;
  },
  fetchFn?: FetchLike,
): Promise<WeixinGetUpdatesResponse> {
  try {
    return await apiPost<WeixinGetUpdatesResponse>(
      {
        baseUrl: input.baseUrl,
        endpoint: "ilink/bot/getupdates",
        body: { get_updates_buf: input.syncBuf },
        token: input.token,
        timeoutMs: input.timeoutMs ?? 35_000,
      },
      fetchFn,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: input.syncBuf };
    }
    throw error;
  }
}

export async function sendWeixinTextMessage(
  input: {
    readonly baseUrl: string;
    readonly token: string;
    readonly to: string;
    readonly text: string;
    readonly contextToken?: string;
  },
  fetchFn?: FetchLike,
): Promise<{ readonly messageId: string; readonly response: WeixinSendMessageResponse }> {
  const text = input.text.trim();
  if (!text) {
    throw new Error("Weixin send text must not be empty.");
  }
  const clientId = `director-weixin-${randomUUID()}`;
  const response = await apiPost<WeixinSendMessageResponse>(
    {
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      token: input.token,
      body: {
        msg: {
          from_user_id: "",
          to_user_id: input.to,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text } }],
          ...(input.contextToken === undefined || input.contextToken.length === 0
            ? {}
            : { context_token: input.contextToken }),
        },
      },
    },
    fetchFn,
  );
  if (
    (response.ret !== undefined && response.ret !== 0) ||
    (response.errcode !== undefined && response.errcode !== 0)
  ) {
    throw new Error(
      `iLink sendmessage failed: ret=${response.ret ?? 0} errcode=${response.errcode ?? 0} ${
        response.errmsg ?? ""
      }`,
    );
  }
  return { messageId: clientId, response };
}

export async function notifyWeixinStart(
  input: { readonly baseUrl: string; readonly token: string },
  fetchFn?: FetchLike,
): Promise<void> {
  await apiPost(
    {
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/msg/notifystart",
      token: input.token,
      body: {},
      timeoutMs: 10_000,
    },
    fetchFn,
  );
}

export async function notifyWeixinStop(
  input: { readonly baseUrl: string; readonly token: string },
  fetchFn?: FetchLike,
): Promise<void> {
  await apiPost(
    {
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/msg/notifystop",
      token: input.token,
      body: {},
      timeoutMs: 10_000,
    },
    fetchFn,
  );
}

export function extractWeixinText(items: readonly unknown[] = []): string {
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("type" in item)) {
      continue;
    }
    const typedItem = item as {
      readonly type?: unknown;
      readonly text_item?: unknown;
      readonly voice_item?: unknown;
    };
    if (typedItem.type === 1) {
      const textItem = typedItem.text_item;
      if (typeof textItem === "object" && textItem !== null && "text" in textItem) {
        const text = (textItem as { readonly text?: unknown }).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text;
        }
      }
    }
    if (typedItem.type === 3) {
      const voiceItem = typedItem.voice_item;
      if (typeof voiceItem === "object" && voiceItem !== null && "text" in voiceItem) {
        const text = (voiceItem as { readonly text?: unknown }).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text;
        }
      }
    }
  }
  return "";
}
