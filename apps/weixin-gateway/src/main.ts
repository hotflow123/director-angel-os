#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { type WeixinDmPolicy, WeixinGateway } from "./adapter.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  ILINK_BASE_URL,
  sendWeixinTextMessage,
  startWeixinQrLogin,
  waitForWeixinQrLogin,
} from "./ilink.js";
import {
  acquireWeixinGatewayLock,
  getContextToken,
  listWeixinAccountIds,
  loadWeixinAccount,
  resolveWeixinHome,
  saveWeixinAccount,
} from "./store.js";

interface CliEnv {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

function printHelp(): void {
  console.log(`Director Angel personal WeChat gateway

Usage:
  director-weixin login              扫码登录个人微信
  director-weixin start              启动个人微信长轮询网关
  director-weixin status             查看已登录账号
  director-weixin send <peer> <text>  给指定微信 peer 发一条测试消息

Important env:
  HOTFLOW_WORKSPACE_ROOT             Director Angel 工作区，默认当前目录
  DIRECTOR_HOST_API_URL              默认 http://127.0.0.1:3201
  DIRECTOR_WEIXIN_ACCOUNT_ID         指定账号；不填用当前首选账号，未设置时用最新保存账号
  DIRECTOR_WEIXIN_DM_POLICY          open | allowlist | disabled，默认 open
  DIRECTOR_WEIXIN_ALLOWED_USERS      allowlist 模式下的微信用户 ID，逗号分隔
  DIRECTOR_WEIXIN_TRUSTED_OPERATORS  可直接改 Skill/能力开关的微信用户 ID，逗号分隔；不填时 allowlist 用户默认可信
  DIRECTOR_WEIXIN_AUTO_ADVANCE       true 时自动 blueprint/run，默认 true
  DIRECTOR_WEIXIN_AUTO_START_RUN     true 时创建 run 后自动 start，默认 true
  DIRECTOR_WEIXIN_HOST_TOOLS         true 时复用 Host API /v1/tools/*，默认 true
`);
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseDmPolicy(raw: string | undefined): WeixinDmPolicy {
  const value = raw?.trim().toLowerCase();
  if (value === "allowlist" || value === "disabled" || value === "open") {
    return value;
  }
  return "open";
}

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function runLogin(ctx: CliEnv): Promise<void> {
  const home = resolveWeixinHome({
    workspaceRoot: ctx.env.HOTFLOW_WORKSPACE_ROOT ?? ctx.cwd,
    env: ctx.env,
  });
  console.log("正在向 Tencent iLink 请求个人微信二维码...");
  const qr = await startWeixinQrLogin({
    baseUrl: ILINK_BASE_URL,
    botType: ctx.env.DIRECTOR_WEIXIN_BOT_TYPE ?? DEFAULT_ILINK_BOT_TYPE,
  });
  console.log("\n请用手机微信扫描这个链接/二维码内容：");
  console.log(qr.qrcodeUrl);
  console.log("\n扫码后在手机微信确认。");
  const credentials = await waitForWeixinQrLogin({
    qrcode: qr.qrcode,
    baseUrl: ILINK_BASE_URL,
    onStatus(message) {
      process.stdout.write(message);
    },
    requestVerifyCode: askLine,
  });
  const account = saveWeixinAccount(home, credentials);
  console.log(`\n已保存个人微信账号：${account.normalizedAccountId}`);
  console.log(`凭据目录：${home}`);
}

async function runStatus(ctx: CliEnv): Promise<void> {
  const home = resolveWeixinHome({
    workspaceRoot: ctx.env.HOTFLOW_WORKSPACE_ROOT ?? ctx.cwd,
    env: ctx.env,
  });
  const ids = listWeixinAccountIds(home);
  if (ids.length === 0) {
    console.log("还没有登录个人微信账号。先运行：director-weixin login");
    return;
  }
  console.log(`个人微信账号目录：${home}`);
  for (const id of ids) {
    const account = loadWeixinAccount(home, id);
    console.log(`- ${id}${account?.userId ? ` · user=${account.userId}` : ""}`);
  }
}

async function loadRequiredAccount(ctx: CliEnv) {
  const home = resolveWeixinHome({
    workspaceRoot: ctx.env.HOTFLOW_WORKSPACE_ROOT ?? ctx.cwd,
    env: ctx.env,
  });
  const account = loadWeixinAccount(home, ctx.env.DIRECTOR_WEIXIN_ACCOUNT_ID);
  if (account === null) {
    throw new Error("没有可用的个人微信账号。先运行 director-weixin login。");
  }
  return { home, account };
}

async function runStart(ctx: CliEnv): Promise<void> {
  const { home, account } = await loadRequiredAccount(ctx);
  const workspaceRoot = ctx.env.HOTFLOW_WORKSPACE_ROOT ?? ctx.cwd;
  const lock = acquireWeixinGatewayLock(home, account.normalizedAccountId, {
    workspaceRoot,
  });
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());

  try {
    const gateway = new WeixinGateway({
      home,
      account,
      workspaceRoot,
      dmPolicy: parseDmPolicy(ctx.env.DIRECTOR_WEIXIN_DM_POLICY),
      allowedUsers: parseCsv(ctx.env.DIRECTOR_WEIXIN_ALLOWED_USERS),
      trustedOperatorUsers: parseCsv(ctx.env.DIRECTOR_WEIXIN_TRUSTED_OPERATORS),
      useHostToolControlPlane: boolEnv(ctx.env.DIRECTOR_WEIXIN_HOST_TOOLS, true),
      director: {
        hostApiUrl: ctx.env.DIRECTOR_HOST_API_URL?.trim() || "http://127.0.0.1:3201",
        hostId: ctx.env.DIRECTOR_WEIXIN_HOST_ID?.trim() || "personal-weixin",
        agentId: ctx.env.DIRECTOR_WEIXIN_AGENT_ID?.trim() || "director",
        channel: "personal-weixin",
        autoAdvance: boolEnv(ctx.env.DIRECTOR_WEIXIN_AUTO_ADVANCE, true),
        autoStartRun: boolEnv(ctx.env.DIRECTOR_WEIXIN_AUTO_START_RUN, true),
      },
    });
    await gateway.start({ abortSignal: controller.signal });
  } finally {
    lock.release();
  }
}

async function runSend(ctx: CliEnv, args: readonly string[]): Promise<void> {
  const to = args[0]?.trim() ?? "";
  const text = args.slice(1).join(" ").trim();
  if (!to || !text) {
    throw new Error("用法：director-weixin send <peer> <text>");
  }
  const { home, account } = await loadRequiredAccount(ctx);
  const contextToken = getContextToken(home, account.normalizedAccountId, to);
  const result = await sendWeixinTextMessage({
    baseUrl: account.baseUrl,
    token: account.token,
    to,
    text,
    ...(contextToken === undefined ? {} : { contextToken }),
  });
  console.log(`已发送：${result.messageId}`);
}

async function main(argv: readonly string[], ctx: CliEnv): Promise<void> {
  const args = argv.slice(2);
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const command = normalizedArgs[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "login") {
    await runLogin(ctx);
    return;
  }
  if (command === "status") {
    await runStatus(ctx);
    return;
  }
  if (command === "start") {
    await runStart(ctx);
    return;
  }
  if (command === "send") {
    await runSend(ctx, normalizedArgs.slice(1));
    return;
  }
  throw new Error(`未知命令：${command}`);
}

void main(process.argv, { env: process.env, cwd: process.cwd() }).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
