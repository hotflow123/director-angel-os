#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const projectId = process.env.MOYIN_SMOKE_PROJECT_ID;
const mediaKind = normalizeMediaKind(process.env.MOYIN_SMOKE_MEDIA_KIND);
const requestFile = process.env.MOYIN_SMOKE_REQUEST_FILE;
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const allowSubmit = process.env.MOYIN_SMOKE_ALLOW_SUBMIT === "1";
const submitApproval = process.env.MOYIN_SMOKE_APPROVAL;
const watchAfterSubmit = process.env.MOYIN_SMOKE_WATCH === "1";
const commandTimeoutMs = readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000);
const watchTimeoutMs = readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000);
const heartbeatIntervalMs = Math.min(
  readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
  30_000,
);

try {
  const result = await runGatedSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-gated-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runGatedSmoke() {
  const status = await runMoyin(["status", "--json"], { timeoutMs: commandTimeoutMs });
  if (!status.ok) {
    const controlPlaneMissing = isControlPlaneUnavailableError(status.stderr);
    const binaryMissing = isBinaryMissingError(status.stderr);
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: controlPlaneMissing && !requireControlPlane ? "unavailable" : "failed",
      exitCode: controlPlaneMissing && !requireControlPlane ? 0 : 1,
      workspaceRoot,
      binary: moyinBinary,
      failedCommand: "status --json",
      stderr: status.stderr,
      nextActions: binaryMissing
        ? [
            "Set MOYIN_BINARY to the Moyin CLI path if it is not available on PATH.",
          ]
        : controlPlaneMissing
          ? ["Start Moyin desktop, then rerun `pnpm moyin:smoke:gated`."]
          : ["Inspect the Moyin CLI status failure before running preview or submit."],
    };
  }

  const discovery = await runReadinessDiscovery();
  if (projectId === undefined) {
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      discovery,
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID to run project-scoped gated checks.",
        "Set MOYIN_SMOKE_REQUEST_FILE to run sealed preview.",
        "Submit remains disabled unless MOYIN_SMOKE_ALLOW_SUBMIT=1 and MOYIN_SMOKE_APPROVAL=SUBMIT.",
      ],
    };
  }

  if (requestFile === undefined) {
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: "readiness-passed",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      discovery,
      submit: {
        attempted: false,
        reason: "request-file-not-provided",
      },
      nextActions: [
        "Set MOYIN_SMOKE_REQUEST_FILE to a Moyin sealed request JSON file for preview.",
        "Keep submit disabled until the preview is executable and operator approval is explicit.",
      ],
    };
  }

  const previewOut = join(
    mkdtempSync(join(tmpdir(), "director-moyin-gated-preview-")),
    `${mediaKind}-preview.json`,
  );
  const preview = await runMoyin(
    ["sealed", mediaKind, "--file", requestFile, "--out", previewOut, "--json"],
    { timeoutMs: commandTimeoutMs },
  );
  if (!preview.ok) {
    return createPreviewFailedResult({ discovery, preview });
  }

  const previewPayload = parseJsonOrNull(preview.stdout);
  const sealedRequestId = readString(previewPayload?.sealedRequestId)
    ?? readString(previewPayload?.sealedRequest?.sealedRequestId);
  const executable = previewPayload?.executable === true && sealedRequestId !== undefined;
  if (!executable) {
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: "preview-blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      mediaKind,
      requestFile,
      previewOut,
      discovery,
      preview: summarizeCommand(preview),
      submit: {
        attempted: false,
        reason: "preview-not-executable",
      },
      nextActions: [
        "Fix missing provider/model/API key/media prerequisites in Moyin.",
        "Rerun gated smoke after the preview reports executable=true and a sealedRequestId.",
      ],
    };
  }

  if (!allowSubmit || submitApproval !== "SUBMIT") {
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: "approval-required",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      mediaKind,
      requestFile,
      previewOut,
      sealedRequestId,
      discovery,
      preview: summarizeCommand(preview),
      submit: {
        attempted: false,
        reason: "explicit-submit-approval-required",
        requiredEnv: {
          MOYIN_SMOKE_ALLOW_SUBMIT: "1",
          MOYIN_SMOKE_APPROVAL: "SUBMIT",
        },
      },
      nextActions: [
        "Review the redacted preview output.",
        "Only rerun with MOYIN_SMOKE_ALLOW_SUBMIT=1 MOYIN_SMOKE_APPROVAL=SUBMIT when you want a real Moyin submit.",
      ],
    };
  }

  const submit = await runMoyin(["sealed", "submit", sealedRequestId, "--confirm", "SUBMIT", "--json"], {
    timeoutMs: commandTimeoutMs,
  });
  if (!submit.ok) {
    return {
      schemaVersion: "director.moyin.gated-smoke.v1",
      status: "submit-failed",
      exitCode: 1,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      mediaKind,
      sealedRequestId,
      discovery,
      preview: summarizeCommand(preview),
      submit: summarizeCommand(submit),
      nextActions: ["Inspect the Moyin sealed submit error; do not retry blindly."],
    };
  }

  const submitPayload = parseJsonOrNull(submit.stdout);
  const taskId = readString(submitPayload?.taskId)
    ?? readString(submitPayload?.id)
    ?? readString(submitPayload?.task?.id)
    ?? readString(submitPayload?.task?.taskId);
  const watch =
    watchAfterSubmit && taskId !== undefined
      ? await watchMoyinTask(taskId)
      : {
          attempted: false,
          reason: taskId === undefined ? "task-id-not-returned" : "watch-disabled",
        };
  const artifacts =
    taskId !== undefined
      ? await runMoyin(["artifact", "list", "--project", projectId, "--type", mediaKind, "--json"], {
          timeoutMs: commandTimeoutMs,
        })
      : undefined;

  return {
    schemaVersion: "director.moyin.gated-smoke.v1",
    status: watch?.status === "timeout" ? "watch-timeout" : "submitted",
    exitCode: watch?.status === "timeout" ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    projectId,
    mediaKind,
    sealedRequestId,
    taskId,
    discovery,
    preview: summarizeCommand(preview),
    submit: summarizeCommand(submit),
    watch,
    ...(artifacts === undefined ? {} : { artifacts: summarizeCommand(artifacts) }),
    nextActions: [
      "Review Moyin task status and artifact list in the desktop app.",
      "Use the returned taskId/resumeToken to resume watch if the smoke timed out.",
    ],
  };
}

async function runReadinessDiscovery() {
  const commands = [
    ["config", "providers", "--json"],
    ["config", "models", "--json"],
    ["task", "template", "list", "--json"],
    ...(projectId === undefined
      ? []
      : [
          ["project", "get", projectId, "--json"],
          ["workflow-run", "list", "--project", projectId, "--json"],
          ["task", "list", "--project", projectId, "--json"],
          ["artifact", "list", "--project", projectId, "--json"],
        ]),
  ];
  const results = [];
  for (const args of commands) {
    const result = await runMoyin(args, { timeoutMs: commandTimeoutMs });
    results.push(summarizeCommand(result));
    if (!result.ok) {
      break;
    }
  }
  return results;
}

function createPreviewFailedResult(input) {
  return {
    schemaVersion: "director.moyin.gated-smoke.v1",
    status: "preview-failed",
    exitCode: 1,
    workspaceRoot,
    binary: moyinBinary,
    projectId,
    mediaKind,
    requestFile,
    discovery: input.discovery,
    preview: summarizeCommand(input.preview),
    nextActions: ["Fix the sealed preview error before any submit is allowed."],
  };
}

function watchMoyinTask(taskId) {
  return new Promise((resolve) => {
    const startedAtMs = Date.now();
    const resumeToken = `moyin-watch:${projectId}:${taskId}`;
    const command = createCommand(["task", "watch", taskId, "--project", projectId, "--json"]);
    const lines = [];
    const child = spawn(command.bin, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const heartbeat = setInterval(() => {
      process.stderr.write(
        `[moyin-gated-smoke] heartbeat task=${taskId} elapsedMs=${Date.now() - startedAtMs}\n`,
      );
    }, heartbeatIntervalMs);
    heartbeat.unref?.();
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      clearInterval(heartbeat);
      resolve({
        attempted: true,
        status: "timeout",
        taskId,
        resumeToken,
        timeoutMs: watchTimeoutMs,
        heartbeatIntervalMs,
        lines,
      });
    }, watchTimeoutMs);
    timeout.unref?.();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) lines.push(line.trim());
      }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      resolve({
        attempted: true,
        status: "failed",
        taskId,
        resumeToken,
        stderr: error.message,
        lines,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      resolve({
        attempted: true,
        status: code === 0 ? "completed" : "failed",
        taskId,
        resumeToken,
        exitCode: code,
        stderr: stderr.trim(),
        lines,
      });
    });
  });
}

function runMoyin(args, options) {
  return new Promise((resolve) => {
    const command = createCommand(args);
    const child = spawn(command.bin, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nCommand timed out after ${options.timeoutMs}ms.`;
    }, options.timeoutMs);
    timeout.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        args,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        args,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });
  });
}

function createCommand(args) {
  return moyinBinary.endsWith(".mjs")
    ? { bin: process.execPath, args: [moyinBinary, ...args] }
    : { bin: moyinBinary, args };
}

function summarizeCommand(result) {
  return {
    ok: result.ok,
    args: result.args,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    stdout: summarizeText(result.stdout),
    stderr: summarizeText(result.stderr),
  };
}

function summarizeText(value) {
  const text = redactJsonText(String(value ?? "").trim());
  return text.length <= 1600 ? text : `${text.slice(0, 1600)}...`;
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function redactJsonText(text) {
  if (text.length === 0) {
    return text;
  }
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(text)), null, 2);
  } catch {
    return text.replace(
      /("(?:token|accessToken|refreshToken|idToken|bearerToken|authorization|apiKey|password|secret|clientSecret)"\s*:\s*)"[^"]*"/giu,
      '$1"[redacted]"',
    );
  }
}

function redactSensitiveValue(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveFieldName(key) ? "[redacted]" : redactSensitiveValue(item),
    ]),
  );
}

function isSensitiveFieldName(key) {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return [
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "bearertoken",
    "authorization",
    "apikey",
    "password",
    "secret",
    "clientsecret",
  ].includes(normalized);
}

function normalizeMediaKind(value) {
  return value === "video" ? "video" : "image";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isBinaryMissingError(stderr) {
  return /ENOENT|not found|no such file/i.test(String(stderr ?? ""));
}

function isControlPlaneUnavailableError(stderr) {
  const text = String(stderr ?? "");
  return (
    /No running Moyin control plane was found/i.test(text) ||
    /\bconnect\s+(?:ECONNREFUSED|EPERM)\s+127\.0\.0\.1:\d+/i.test(text) ||
    /\bconnect\s+(?:ECONNREFUSED|EPERM)\s+localhost:\d+/i.test(text)
  );
}
