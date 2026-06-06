import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const activeRoots = ["apps", "packages", "services", "internal-plugins"];
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".codex-backups",
  ".git",
  ".turbo",
  "dist",
  "node_modules",
  "参考仓库",
]);

const allowedChildProcessImportFiles = new Map([
  [
    "apps/director-desktop/scripts/launch-electron.mjs",
    "Developer-only Electron launcher owns the child process and forwards termination signals to the launched app.",
  ],
  [
    "apps/director-desktop/scripts/launch-visible-electron.mjs",
    "Developer-only visible Electron launcher owns the child process and uses signal-zero only for stale lock liveness probing.",
  ],
  [
    "apps/director-desktop/src/desktop-cli-process-runner.cjs",
    "Desktop CLI backend runner is called only after Agent OS host sandbox admission.",
  ],
  [
    "apps/director-desktop/src/desktop-browser-tool-service.js",
    "Managed Angel Chrome launch is blocked by default and requires explicit operator-scoped DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH=1.",
  ],
  [
    "apps/director-desktop/src/desktop-system-handlers.js",
    "Desktop host command/open-url runners build exact Agent OS argv patterns before execution.",
  ],
  [
    "apps/director-desktop/src/desktop-weixin-gateway-service.js",
    "Weixin lifecycle commands are routed through Agent OS host sandbox argv patterns.",
  ],
  [
    "apps/director-desktop/src/electron-main.cjs",
    "Electron main exposes backend runners for sandbox-admitted desktop bridge operations.",
  ],
  [
    "packages/conversation-runtime/src/external-provider-auth.ts",
    "exec SecretRef uses Agent OS sync sandbox admission and exact allowedCommandPatterns.",
  ],
  [
    "packages/conversation-runtime/src/mcp-client.ts",
    "MCP stdio and keychain helpers require Agent OS sandbox admission before process execution.",
  ],
  [
    "packages/conversation-runtime/src/moyin-provider.ts",
    "Moyin provider runner is an external-tool provider boundary with sealed submit approval metadata and injected runner support for sandbox orchestration.",
  ],
  [
    "packages/conversation-runtime/src/opencli-tools.ts",
    "OpenCLI runner is the external browser/content bridge boundary; desktop app launch fallbacks are explicitly denied and auth failures fail closed.",
  ],
  [
    "services/mempalace-adapter/src/command-client.ts",
    "MemPalace command client wraps spawnSync in Agent OS host sandbox exact argv admission.",
  ],
]);

const allowedShellOpenExternalFiles = new Map([
  [
    "apps/director-desktop/src/electron-main.cjs",
    "shell.openExternal is only used as the admitted desktop open-url backend runner.",
  ],
]);

const allowedProcessKillFiles = new Map([
  [
    "apps/director-desktop/scripts/launch-visible-electron.mjs",
    "process.kill(pid, 0) is only used to detect stale Electron SingletonLock liveness.",
  ],
  [
    "apps/weixin-gateway/src/store.ts",
    "process.kill(pid, 0) is a liveness probe and does not terminate a process.",
  ],
]);

const allowedLegacyPrefixReadLines = new Map([
  [
    "packages/agent-os-sandbox/src/index.ts",
    [
      "(options as { readonly allowedCommandPrefixes?: unknown }).allowedCommandPrefixes",
      "readonly commandPrefix?: string;",
      "const commandPrefix =",
      'typeof backendConfig?.commandPrefix === "string" ? backendConfig.commandPrefix : undefined;',
      "...(commandPrefix === undefined ? {} : { commandPrefix }),",
    ],
  ],
  [
    "packages/conversation-runtime/src/external-provider-auth.ts",
    [
      "(sandboxOptions as { readonly allowedCommandPrefixes?: unknown })",
      ".allowedCommandPrefixes;",
    ],
  ],
  [
    "packages/director-host-contracts/src/types.ts",
    ["commandPrefix?: string;", "isOptional(value.commandPrefix, isString)"],
  ],
]);

const forbiddenLiveAudioSideEffects = [
  {
    pattern: /navigator\.mediaDevices\.getUserMedia\s*\(/iu,
    detail: "Desktop/browser microphone capture must not auto-start in the non-voice release gate.",
  },
  {
    pattern: /new\s+MediaRecorder\s*\(/iu,
    detail: "MediaRecorder must stay behind an explicit voice runner admission path.",
  },
  {
    pattern: /new\s+AudioContext\s*\(/iu,
    detail:
      "AudioContext must not be created by active runtime source during non-voice release checks.",
  },
  {
    pattern: /\bspeechSynthesis\.speak\s*\(/iu,
    detail: "TTS playback must not auto-start during non-voice release checks.",
  },
  {
    pattern: /\b(?:SpeechRecognition|webkitSpeechRecognition)\b/iu,
    detail: "Browser STT APIs must not be wired directly into active runtime source.",
  },
];

const voiceScanRoots = [
  "apps/director-desktop/src",
  "packages/agent-os-extensions/src",
  "packages/conversation-runtime/src",
  "packages/director-runtime/src",
];

function toPosixPath(path) {
  return path.split(/[\\/]+/u).join("/");
}

function shouldIgnorePath(path) {
  const normalized = toPosixPath(path);
  if (normalized.includes("/._")) {
    return true;
  }
  if (
    normalized.endsWith(".map") ||
    normalized.endsWith(".tsbuildinfo") ||
    /\.bak(?:\.|$)/u.test(normalized)
  ) {
    return true;
  }
  const basename = normalized.split("/").at(-1) ?? "";
  return (
    basename.startsWith("._") ||
    /\.test\.[cm]?[jt]sx?$/u.test(basename) ||
    /\.spec\.[cm]?[jt]sx?$/u.test(basename)
  );
}

function walkSourceFiles(root) {
  const files = [];
  function visit(path) {
    if (shouldIgnorePath(path)) {
      return;
    }
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const basename = toPosixPath(path).split("/").at(-1) ?? "";
      if (ignoredDirectories.has(basename)) {
        return;
      }
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }
    if (stat.isFile() && sourceExtensions.has(extname(path))) {
      files.push(path);
    }
  }
  visit(root);
  return files;
}

function readLines(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/u);
}

function createIssue(rule, file, line, detail) {
  return {
    rule,
    file,
    line,
    detail,
  };
}

function lineMatchesAllowedLegacyPrefix(relPath, line) {
  const allowedLines = allowedLegacyPrefixReadLines.get(relPath);
  if (allowedLines === undefined) {
    return false;
  }
  return allowedLines.some((allowedLine) => line.includes(allowedLine));
}

function scanFile(repoRoot, filePath) {
  const relPath = toPosixPath(filePath.slice(repoRoot.length + 1));
  const lines = readLines(filePath);
  const content = lines.join("\n");
  const issues = [];

  if (/(?:node:)?child_process/u.test(content) && !allowedChildProcessImportFiles.has(relPath)) {
    issues.push(
      createIssue(
        "child-process-import",
        relPath,
        null,
        "Active runtime source imports child_process outside the Agent OS backend allowlist.",
      ),
    );
  }

  if (/shell\.openExternal\s*\(/u.test(content) && !allowedShellOpenExternalFiles.has(relPath)) {
    issues.push(
      createIssue(
        "shell-open-external",
        relPath,
        null,
        "shell.openExternal is only allowed behind the desktop open-url sandbox backend.",
      ),
    );
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/process\.kill\s*\(/u.test(line) && !allowedProcessKillFiles.has(relPath)) {
      issues.push(
        createIssue(
          "process-kill",
          relPath,
          lineNumber,
          "process.kill is only allowed for signal-0 liveness probing in the Weixin store.",
        ),
      );
    }

    if (
      /\b(?:allowedCommandPrefixes|weixinGatewayAllowedCommandPrefixes|commandPrefix)\b/u.test(
        line,
      ) &&
      !lineMatchesAllowedLegacyPrefix(relPath, line)
    ) {
      issues.push(
        createIssue(
          "legacy-command-prefix",
          relPath,
          lineNumber,
          "Legacy command prefix APIs/evidence may only appear in fail-closed readers or historical ledger DTOs.",
        ),
      );
    }
  });

  return issues;
}

function scanVoiceRunnerSideEffects(repoRoot) {
  const files = voiceScanRoots
    .map((root) => resolve(repoRoot, root))
    .flatMap((root) => walkSourceFiles(root));
  const issues = [];
  for (const file of files) {
    const relPath = toPosixPath(file.slice(repoRoot.length + 1));
    readLines(file).forEach((line, index) => {
      for (const item of forbiddenLiveAudioSideEffects) {
        if (item.pattern.test(line)) {
          issues.push(createIssue("live-audio-side-effect", relPath, index + 1, item.detail));
          break;
        }
      }
    });
  }
  return issues;
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const activeFiles = activeRoots
  .map((root) => resolve(repoRoot, root))
  .flatMap((root) => walkSourceFiles(root));
const issues = activeFiles.flatMap((file) => scanFile(repoRoot, file));
const voiceIssues = scanVoiceRunnerSideEffects(repoRoot);
const allIssues = [...issues, ...voiceIssues];

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(
  resultsDir,
  "director-phase-c27-agent-os-non-voice-release-safety-gate-latest.json",
);
const report = {
  summary: {
    suiteId: "director-phase-c27-agent-os-non-voice-release-safety-gate",
    timestamp: new Date().toISOString(),
    scannedFiles: activeFiles.length,
    voiceScannedRoots: voiceScanRoots,
    issueCount: allIssues.length,
    checks: {
      childProcessImports: "allowlist-only",
      shellOpenExternal: "sandbox-backend-only",
      processKill: "signal-zero-liveness-only",
      legacyCommandPrefixes: "fail-closed-reader-or-ledger-only",
      voiceRunners: "fail-closed-no-device-or-playback-side-effects",
    },
  },
  allowedChildProcessImportFiles: Object.fromEntries(allowedChildProcessImportFiles),
  issues: allIssues,
};

writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Director Agent OS non-voice release safety gate completed: ${activeFiles.length} files scanned, issues ${allIssues.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (allIssues.length > 0) {
  for (const issue of allIssues.slice(0, 20)) {
    process.stderr.write(
      `${issue.rule}: ${issue.file}${issue.line === null ? "" : `:${issue.line}`} ${issue.detail}\n`,
    );
  }
  if (allIssues.length > 20) {
    process.stderr.write(`... ${allIssues.length - 20} more issues\n`);
  }
  process.exitCode = 1;
}
