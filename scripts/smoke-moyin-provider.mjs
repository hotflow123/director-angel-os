#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const projectId = process.env.MOYIN_SMOKE_PROJECT_ID;
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

const readOnlyCommands = [
  ["status", "--json"],
  ["config", "providers", "--json"],
  ["config", "models", "--json"],
  ["task", "template", "list", "--json"],
  ["prompt", "schema", "--json"],
  ...(projectId === undefined
    ? []
    : [
        ["project", "get", projectId, "--json"],
        ["workflow", "list", "--project", projectId, "--json"],
        ["workflow-run", "list", "--project", projectId, "--json"],
        ["task", "list", "--project", projectId, "--json"],
        ["prompt", "list", "--project", projectId, "--json"],
        ["memory", "get", "--project", projectId, "--json"],
      ]),
];

try {
  const results = [];
  for (const args of readOnlyCommands) {
    const result = await runMoyin(args);
    results.push(result);
    if (!result.ok) {
      const controlPlaneMissing = isControlPlaneUnavailableError(result.stderr);
      const binaryMissing = isBinaryMissingError(result.stderr);
      const unavailableStatus = {
        schemaVersion: "director.moyin.readonly-smoke.v1",
        status: controlPlaneMissing && !requireControlPlane ? "unavailable" : "failed",
        workspaceRoot,
        binary: moyinBinary,
        projectId,
        failedCommand: args.join(" "),
        stderr: result.stderr,
        results,
        nextActions: binaryMissing
          ? [
              "Set MOYIN_BINARY to the Moyin CLI path if it is not available on PATH.",
            ]
          : controlPlaneMissing
            ? ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:readonly`."]
            : ["Inspect the failing Moyin CLI command and provider contract."],
      };
      process.stdout.write(`${JSON.stringify(unavailableStatus, null, 2)}\n`);
      process.exit(controlPlaneMissing && !requireControlPlane ? 0 : 1);
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "director.moyin.readonly-smoke.v1",
        status: "passed",
        workspaceRoot,
        binary: moyinBinary,
        projectId,
        commandCount: results.length,
        results,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`[moyin-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

function runMoyin(args) {
  const command = moyinBinary.endsWith(".mjs") ? process.execPath : moyinBinary;
  const commandArgs = moyinBinary.endsWith(".mjs") ? [moyinBinary, ...args] : args;
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        args,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        args,
        stdout: summarizeStdout(stdout),
        stderr: stderr.trim(),
      });
    });
  });
}

function summarizeStdout(stdout) {
  const trimmed = stdout.trim();
  const redacted = redactJsonText(trimmed);
  if (redacted.length <= 1200) {
    return redacted;
  }
  return `${redacted.slice(0, 1200)}...`;
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
