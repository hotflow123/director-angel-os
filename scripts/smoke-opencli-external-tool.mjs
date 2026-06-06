#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

prependToolPaths();

const hostApiUrl = trimTrailingSlash(
  process.env.DIRECTOR_HOST_API_URL ?? process.env.OPENCLI_SMOKE_HOST_API_URL ?? "http://127.0.0.1:3201",
);
const openCliStatusUrl = process.env.OPENCLI_DAEMON_STATUS_URL ?? "http://127.0.0.1:19825/status";
const openCliBinary = process.env.OPENCLI_BINARY?.trim() || "opencli";
const sessionKey = process.env.OPENCLI_SMOKE_SESSION_KEY?.trim() || "weixin:bot:friend";
const realDownload = parseBoolean(process.env.OPENCLI_SMOKE_REAL_DOWNLOAD);
const realDownloadTimeoutMs = parsePositiveInteger(
  process.env.OPENCLI_SMOKE_REAL_DOWNLOAD_TIMEOUT_MS,
  300_000,
);
const downloadDir = resolve(
  process.env.OPENCLI_SMOKE_DOWNLOAD_DIR?.trim() ||
    join(tmpdir(), `opencli-smoke-bilibili-${Date.now()}`),
);

const requiredCapabilities = [
  { label: "xiaohongshu download", site: "xiaohongshu", name: "download" },
  { label: "bilibili download", site: "bilibili", name: "download" },
  { label: "twitter download", site: "twitter", name: "download" },
  { label: "pixiv download", site: "pixiv", name: "download" },
  { label: "1688 download", site: "1688", name: "download" },
  { label: "xiaoyuzhou download", site: "xiaoyuzhou", name: "download" },
  { label: "xiaoyuzhou transcript", site: "xiaoyuzhou", name: "transcript" },
  { label: "zhihu download", site: "zhihu", name: "download" },
  { label: "weixin download", site: "weixin", name: "download" },
  { label: "douban download", site: "douban", name: "download" },
];

const checks = [];
const warnings = [];

async function main() {
  log(`host-api: ${hostApiUrl}`);
  log(`session-key: ${sessionKey}`);
  log(`real-download: ${realDownload ? "enabled" : "disabled"}`);
  if (realDownload) {
    log(`real-download-timeout-ms: ${realDownloadTimeoutMs}`);
  }

  const openCliVersion = await runRequired("OpenCLI binary", async () => {
    const result = await execFileAsync(openCliBinary, ["--version"], { timeout: 10_000 });
    return String(result.stdout ?? "").trim() || "installed";
  });
  log(`opencli: ${openCliVersion}`);

  const ytDlpVersion = await runOptional("yt-dlp binary", async () => {
    const result = await execFileAsync("yt-dlp", ["--version"], { timeout: 10_000 });
    return String(result.stdout ?? "").trim();
  });
  if (ytDlpVersion !== undefined) {
    log(`yt-dlp: ${ytDlpVersion}`);
  }
  if (realDownload && ytDlpVersion === undefined) {
    fail("yt-dlp is required when OPENCLI_SMOKE_REAL_DOWNLOAD=1.");
  }

  await runRequired("OpenCLI daemon and Browser Bridge", async () => {
    const status = await fetchJson(openCliStatusUrl, { headers: { "X-OpenCLI": "1" } });
    assert(status?.ok === true, `daemon status is not ok: ${JSON.stringify(status)}`);
    assert(status?.extensionConnected === true, "Browser Bridge extension is not connected.");
    return `${status.daemonVersion ?? "unknown"} / extension ${status.extensionVersion ?? "unknown"}`;
  });

  await runRequired("OpenCLI doctor", async () => {
    const result = await execFileAsync(openCliBinary, ["doctor"], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert(/Everything looks good!/u.test(text), "opencli doctor did not report readiness.");
    return "ready";
  });

  const effective = await runRequired("Host API tools/effective", async () => {
    const payload = await fetchJson(
      `${hostApiUrl}/v1/tools/effective?includeUnavailable=true&sessionKey=${encodeURIComponent(
        sessionKey,
      )}&profile=weixin`,
    );
    const tool = (payload.tools ?? []).find((entry) => entry.id === "opencli.local");
    assert(tool !== undefined, "opencli.local is missing from Host API tools/effective.");
    assert(tool.enabled === true, "opencli.local is not enabled.");
    assert(tool.status === "ready", `opencli.local status is ${tool.status ?? "unknown"}.`);
    assert(tool.canInvoke === true, "opencli.local cannot invoke.");
    assert(Number(tool.capabilityCount ?? 0) > 0, "opencli.local has no capabilities.");
    return {
      id: tool.id,
      status: tool.status,
      canInvoke: tool.canInvoke,
      capabilityCount: tool.capabilityCount,
      capabilities: tool.capabilities ?? [],
    };
  });

  await runRequired("Required OpenCLI capabilities", async () => {
    const missing = requiredCapabilities.filter(
      (item) =>
        !effective.capabilities.some(
          (capability) => capability.metadata?.site === item.site && capability.metadata?.name === item.name,
        ),
    );
    assert(
      missing.length === 0,
      `missing capabilities: ${missing.map((item) => item.label).join(", ")}`,
    );
    return `${requiredCapabilities.length} required capabilities present`;
  });

  await runRequired("Host API tools/invoke opencli.list", async () => {
    const result = await invokeHostTool("opencli.list", { site: "weixin" }, "smoke-opencli-list-weixin");
    assert(result.ok === true, `opencli.list failed: ${JSON.stringify(summarizeInvokeResult(result))}`);
    const entries = result.output?.entries ?? [];
    assert(
      entries.some((entry) => entry.site === "weixin" && entry.name === "download"),
      "weixin/download was not returned by opencli.list.",
    );
    return `weixin commands: ${entries.map((entry) => entry.name).join(", ")}`;
  });

  if (realDownload) {
    await runRequired("Host API tools/invoke bilibili.download real file write", async () => {
      await rm(downloadDir, { recursive: true, force: true });
      await mkdir(downloadDir, { recursive: true });
      const result = await invokeHostTool(
        "opencli.bilibili.download",
        {
          bvid: process.env.OPENCLI_SMOKE_BILIBILI_BVID?.trim() || "BV1xx411c7mD",
          output: downloadDir,
          quality: process.env.OPENCLI_SMOKE_BILIBILI_QUALITY?.trim() || "480p",
        },
        `smoke-opencli-bilibili-${Date.now()}`,
        realDownloadTimeoutMs,
      );
      assert(
        result.ok === true && result.status === "success",
        `bilibili.download failed: ${JSON.stringify(summarizeInvokeResult(result))}`,
      );
      const files = await listFiles(downloadDir);
      const mediaFiles = files.filter((file) => /\.(m4a|mp4|flv|webm|mkv)$/iu.test(file.name));
      const totalMediaBytes = mediaFiles.reduce((sum, file) => sum + file.size, 0);
      assert(mediaFiles.length > 0, `no media files were written to ${downloadDir}`);
      assert(totalMediaBytes > 10 * 1024 * 1024, `media output is too small: ${totalMediaBytes} bytes`);
      return `${mediaFiles.length} media file(s), ${formatBytes(totalMediaBytes)}, dir=${downloadDir}`;
    });
  }

  printSummary();
}

async function invokeHostTool(operationId, args, idempotencyKey, timeoutMs) {
  return fetchJson(`${hostApiUrl}/v1/tools/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    body: JSON.stringify({
      toolId: "opencli.local",
      operationId,
      args,
      sessionKey,
      idempotencyKey,
    }),
  });
}

async function runRequired(name, action) {
  try {
    const detail = await action();
    checks.push({ name, status: "PASS", detail });
    log(`PASS ${name}${detail === undefined ? "" : `: ${stringifyDetail(detail)}`}`);
    return detail;
  } catch (error) {
    checks.push({ name, status: "FAIL", detail: String(error?.message ?? error) });
    fail(`${name} failed: ${String(error?.message ?? error)}`);
  }
}

async function runOptional(name, action) {
  try {
    const detail = await action();
    checks.push({ name, status: "PASS", detail });
    return detail;
  } catch (error) {
    const detail = String(error?.message ?? error);
    checks.push({ name, status: "WARN", detail });
    warnings.push(`${name}: ${detail}`);
    log(`WARN ${name}: ${detail}`);
    return undefined;
  }
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(init.timeoutMs ?? 60_000));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 500)}`, { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const path = join(dir, entry.name);
    const info = await stat(path);
    files.push({ name: entry.name, path, size: info.size });
  }
  return files;
}

function summarizeInvokeResult(result) {
  return {
    ok: result?.ok,
    status: result?.status,
    error: result?.error,
    content: String(result?.content ?? "").slice(0, 300),
    exitCode: result?.metadata?.runner?.exitCode,
    stderr: String(result?.metadata?.runner?.stderr ?? "").slice(0, 300),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/u, "");
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/iu.test(String(value ?? "").trim());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function prependToolPaths() {
  const home = homedir();
  const candidates = [
    join(home, ".local", "node-current", "bin"),
    join(home, "Library", "Python", "3.9", "bin"),
    join(home, ".local", "bin"),
  ];
  const existingPath = process.env.PATH ?? "";
  const parts = existingPath.split(":").filter(Boolean);
  process.env.PATH = [
    ...candidates.filter((path) => existsSync(path) && !parts.includes(path)),
    ...parts,
  ].join(":");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stringifyDetail(detail) {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail.capabilities)) {
    const { capabilities: _capabilities, ...summary } = detail;
    return JSON.stringify(summary);
  }
  return JSON.stringify(detail);
}

function printSummary() {
  const failed = checks.filter((check) => check.status === "FAIL");
  log("summary:");
  for (const check of checks) {
    log(`  ${check.status} ${check.name}`);
  }
  if (warnings.length > 0) {
    log(`warnings: ${warnings.length}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  log("overall: READY");
}

function log(message) {
  process.stdout.write(`[opencli-smoke] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[opencli-smoke] ERROR: ${message}\n`);
  process.stderr.write(
    "[opencli-smoke] next action: run `pnpm opencli:bridge`, ensure Host API is listening on 127.0.0.1:3201, then retry.\n",
  );
  process.exit(1);
}

main().catch((error) => {
  fail(`Unexpected smoke failure: ${String(error?.stack ?? error)}`);
});
