import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-cnext-agent-os-runner-scan-migration-batch-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const activeRoots = ["apps", "packages", "services", "internal-plugins"];
const focusedRoots = [
  "apps/director-desktop/src",
  "apps/weixin-gateway/src",
  "packages/agent-os-extensions/src",
  "packages/conversation-runtime/src",
  "packages/director-runtime/src",
  "services/mempalace-adapter/src",
  "internal-plugins",
];
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".codex-backups",
  ".git",
  ".turbo",
  "dist",
  "node_modules",
  "参考仓库",
]);

const allowedProcessRunnerFiles = new Map([
  [
    "apps/director-desktop/scripts/launch-electron.mjs",
    {
      runnerKind: "desktop-dev-electron-launcher",
      evidence: ["DIRECTOR_DESKTOP_LAUNCHED_BY", "child.kill(signal)", 'child.on("exit"'],
      reason:
        "Developer launcher owns the Electron child process and forwards operator termination signals.",
    },
  ],
  [
    "apps/director-desktop/scripts/launch-visible-electron.mjs",
    {
      runnerKind: "desktop-dev-visible-electron-launcher",
      evidence: [
        "DIRECTOR_DESKTOP_VISIBLE_WINDOW_TIMEOUT_MS",
        "cleanStaleSingletonLock",
        "process.kill(pid, 0)",
        "child?.kill?.(signal)",
      ],
      reason:
        "Developer visible launcher owns the Electron child and uses signal-zero only for stale SingletonLock liveness.",
    },
  ],
  [
    "apps/director-desktop/src/desktop-cli-process-runner.cjs",
    {
      runnerKind: "desktop-cli-process",
      evidence: ["createCliProcessEvidence", "sendProcessSignal", "ownedProcess"],
      companionEvidence: [
        {
          file: "apps/director-desktop/src/desktop-cli-sandbox-runner.js",
          needles: [
            "createDirectorDesktopCliSandboxRunner",
            "allowedCommandPatterns",
            "executeAgentOsSandboxCommand",
          ],
        },
        {
          file: "apps/director-desktop/src/electron-main.cjs",
          needles: ["createDirectorDesktopCliSandboxRunner", "runProcessCommand"],
        },
      ],
      reason:
        "Desktop CLI child process execution is owned by the desktop CLI sandbox runner and emits process evidence.",
    },
  ],
  [
    "apps/director-desktop/src/electron-main.cjs",
    {
      runnerKind: "desktop-main-bridge",
      evidence: [
        "createDirectorDesktopCliSandboxRunner",
        "createDesktopOpenExternalUrlSandboxRunner",
        "shell.openExternal",
        "openExternalUrl",
      ],
      reason:
        "Electron main only injects the admitted CLI process runner and the admitted http(s) open-url backend.",
    },
  ],
  [
    "apps/director-desktop/src/desktop-system-handlers.js",
    {
      runnerKind: "desktop-system-handlers",
      evidence: [
        "createDesktopExternalToolSandboxBackends",
        "createDesktopComfyUiSandboxCommandRunner",
        "createDesktopOpenExternalUrlSandboxRunner",
        "allowedCommandPatterns",
        "executeAgentOsSandboxCommand",
        "summarizeAgentOsProcessCapabilityLedger",
      ],
      reason:
        "Desktop ComfyUI, open-url, and SecretRef helpers route through Agent OS sandbox backends and process ledger evidence.",
    },
  ],
  [
    "apps/director-desktop/src/desktop-weixin-gateway-service.js",
    {
      runnerKind: "weixin-gateway-lifecycle",
      evidence: [
        "runWeixinGatewaySandboxCommand",
        "resolveWeixinGatewayAllowedCommandPatterns",
        "createWeixinGatewayKillProcessEvidence",
        "executeAgentOsSandboxCommand",
      ],
      reason:
        "Weixin gateway lifecycle commands route through exact Agent OS host command patterns with owned process signal evidence.",
    },
  ],
  [
    "apps/director-desktop/src/desktop-browser-tool-service.js",
    {
      runnerKind: "desktop-browser-operator-scoped-managed-profile",
      evidence: [
        "DIRECTOR_ALLOW_MANAGED_BROWSER_LAUNCH",
        "MANAGED_CHROME_LAUNCH_BLOCKED_MESSAGE",
        "launch-blocked",
        "spawnImpl(executable, args",
      ],
      reason:
        "Angel managed browser launch is fail-closed by default and requires explicit operator-scoped env enablement.",
    },
  ],
  [
    "packages/conversation-runtime/src/external-provider-auth.ts",
    {
      runnerKind: "exec-secretref",
      evidence: [
        "resolveExecSecretRefWithSandbox",
        "allowedCommandPatterns",
        "admitAgentOsSandboxExecutionSync",
        "executeAgentOsSandboxCommandSync",
        "readLegacyExecSecretAllowedCommandPrefixes",
      ],
      reason:
        "Exec SecretRef resolution uses sync Agent OS sandbox admission and fails closed on legacy prefix configuration.",
    },
  ],
  [
    "packages/conversation-runtime/src/mcp-client.ts",
    {
      runnerKind: "mcp-stdio-and-keychain",
      evidence: [
        "createSandboxedMcpStdioTransportRequest",
        "assertAgentOsSandboxLongLivedProcessSpawnAdmitted",
        "runMcpKeychainSecurityCommand",
        "allowedCommandPatterns",
      ],
      reason:
        "MCP stdio long-lived spawn and keychain helpers require admitted Agent OS sandbox evidence.",
    },
  ],
  [
    "packages/conversation-runtime/src/moyin-provider.ts",
    {
      runnerKind: "moyin-external-tool-provider",
      evidence: [
        "approvalBoundary",
        "sealed.submit",
        "safeRetry",
        "createDefaultMoyinProviderRunner",
      ],
      reason:
        "Moyin CLI access is represented as an external-tool provider with sealed submit approval metadata and injectable runner orchestration.",
    },
  ],
  [
    "packages/conversation-runtime/src/opencli-tools.ts",
    {
      runnerKind: "opencli-external-browser-content-bridge",
      evidence: [
        "DESKTOP_APP_LAUNCH_DENY_RE",
        "createOpenCliRunnerEnvironment",
        "OPENCLI_BACKGROUND_WINDOW_MODE",
        "createDefaultOpenCliRunner",
      ],
      reason:
        "OpenCLI runs as the controlled browser/content bridge boundary, with desktop-app launch fallbacks denied and auth failures fail-closed.",
    },
  ],
  [
    "services/mempalace-adapter/src/command-client.ts",
    {
      runnerKind: "mempalace-command",
      evidence: [
        "defaultMempalaceCommandExecutor",
        "allowedCommandPatterns",
        "admitAgentOsSandboxExecutionSync",
        "executeAgentOsSandboxCommandSync",
      ],
      reason: "MemPalace command execution is wrapped by the Agent OS host sandbox sync executor.",
    },
  ],
]);

const allowedShellOpenExternalFiles = new Map([
  [
    "apps/director-desktop/src/electron-main.cjs",
    "shell.openExternal is only used behind createDesktopOpenExternalUrlSandboxRunner.",
  ],
]);

const allowedProcessKillFiles = new Map([
  [
    "apps/director-desktop/scripts/launch-visible-electron.mjs",
    {
      requiredNeedle: "process.kill(pid, 0)",
      reason: "Visible launcher uses process.kill(pid, 0) only as a stale lock liveness probe.",
    },
  ],
  [
    "apps/weixin-gateway/src/store.ts",
    {
      requiredNeedle: "process.kill(pid, 0)",
      reason: "process.kill(pid, 0) is a liveness probe and does not terminate a process.",
    },
  ],
]);

const allowedChildKillFiles = new Map([
  [
    "apps/director-desktop/scripts/launch-electron.mjs",
    {
      requiredNeedle: "child.kill(signal)",
      reason:
        "Developer launcher forwards operator termination signals to its owned Electron child.",
    },
  ],
  [
    "apps/director-desktop/scripts/launch-visible-electron.mjs",
    {
      requiredNeedle: "child?.kill?.(signal)",
      reason:
        "Developer visible launcher forwards operator termination signals to its owned Electron child.",
    },
  ],
  [
    "apps/director-desktop/src/desktop-cli-process-runner.cjs",
    {
      requiredNeedle: "sendProcessSignal(child,",
      reason: "Desktop CLI timeout cleanup records signal evidence for the owned child process.",
    },
  ],
  [
    "packages/conversation-runtime/src/mcp-client.ts",
    {
      requiredNeedle: 'terminationReason: "mcp-stdio-close"',
      reason: "MCP close signals are recorded as process evidence for the admitted stdio process.",
    },
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

const auditedElectronBrowserWindowFiles = new Map([
  [
    "apps/director-desktop/src/desktop-browser-fetch.js",
    "Electron BrowserWindow learning fetch surface; no external Playwright/Chromium process runner.",
  ],
  [
    "apps/director-desktop/src/desktop-browser-tool-service.js",
    "Electron BrowserWindow browser tool surface; no external Playwright/Chromium process runner.",
  ],
  [
    "apps/director-desktop/src/electron-main.cjs",
    "Electron main wires BrowserWindow services and the admitted open-url backend.",
  ],
]);

const blockedRunnerTerms = [
  {
    id: "playwright-runner",
    pattern: /\bplaywright\b/iu,
    allowedLines: [
      {
        file: "apps/director-desktop/src/desktop-system-handlers.js",
        includes: '["testing", /\\b(test|testing|vitest|jest|playwright|e2e|tdd|coverage)\\b/u]',
        reason: "Skill category keyword classifier, not a runner import or process launch.",
      },
      {
        file: "packages/skills/src/reference-import.ts",
        includes: '[/browser|playwright|chromium/u, "browser"]',
        reason: "Skill reference import tool classifier, not a runner import or process launch.",
      },
    ],
    detail:
      "Playwright must not appear in active runtime source unless it is migrated through the long-lived process contract.",
  },
  {
    id: "chromium-runner",
    pattern: /\bchromium\b/iu,
    allowedLines: [
      {
        file: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "/Applications/Chromium.app/Contents/MacOS/Chromium",
        reason:
          "Audited managed-browser executable candidate, launch blocked unless operator enables it.",
      },
      {
        file: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "No Chromium-based browser executable was found.",
        reason: "Operator-facing missing-browser diagnostic, not an unmanaged launch.",
      },
      {
        file: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "安装 Google Chrome、Chromium、Brave 或 Edge 后再启动 Angel Chrome",
        reason: "Operator setup guidance for the audited managed-browser path.",
      },
      {
        file: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: '"chromium.exe"',
        reason:
          "Audited managed-browser executable candidate, launch blocked unless operator enables it.",
      },
      {
        file: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: '"chromium-browser"',
        reason:
          "Audited managed-browser executable candidate, launch blocked unless operator enables it.",
      },
      {
        file: "packages/conversation-runtime/src/opencli-tools.ts",
        includes: 'text.includes("please open chromium")',
        reason: "OpenCLI auth-required diagnostic parser, not a Chromium runner.",
      },
      {
        file: "packages/skills/src/reference-import.ts",
        includes: '[/browser|playwright|chromium/u, "browser"]',
        reason: "Skill reference import tool classifier, not a runner import or process launch.",
      },
    ],
    detail:
      "Chromium must not appear in active runtime source unless it is migrated through the long-lived process contract.",
  },
  {
    id: "puppeteer-runner",
    pattern: /\bpuppeteer\b/iu,
    allowedLines: [],
    detail:
      "Puppeteer must not appear in active runtime source unless it is migrated through the long-lived process contract.",
  },
  {
    id: "ffmpeg-runner",
    pattern: /\bffmpeg\b/iu,
    allowedLines: [
      {
        file: "packages/skills/src/reference-import.ts",
        includes: '[/ffmpeg|video-frames/u, "ffmpeg"]',
        reason: "Skill reference import tool classifier, not a runner import or process launch.",
      },
    ],
    detail:
      "ffmpeg must not appear in active runtime source unless it is migrated through Agent OS sandbox command execution.",
  },
  {
    id: "ffprobe-runner",
    pattern: /\bffprobe\b/iu,
    allowedLines: [],
    detail:
      "ffprobe must not appear in active runtime source unless it is migrated through Agent OS sandbox command execution.",
  },
  {
    id: "local-media-server-runner",
    pattern: /\blocal-media-server\b/iu,
    allowedLines: [],
    detail:
      "Local media servers must not appear in active runtime source unless their lifecycle is admitted and tracked.",
  },
  {
    id: "jupyter-notebook-runner",
    pattern: /\b(?:jupyter|ipynb)\b/iu,
    allowedLines: [],
    detail:
      "Notebook process runners must not appear in active runtime source unless their lifecycle is admitted and tracked.",
  },
];

const auditedDryRunRunnerLines = [
  {
    file: "packages/agent-os-extensions/src/index.ts",
    includes: "media-analysis-runner inspect --fixture dry-run",
    reason: "B.next dry-run provider runner manifest, not a live process launch.",
  },
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

function lineMatchesAllowance(relPath, line, allowances) {
  return allowances.some(
    (allowance) => allowance.file === relPath && line.includes(allowance.includes),
  );
}

function scanProcessRunnerFile(repoRootPath, filePath) {
  const relPath = toPosixPath(filePath.slice(repoRootPath.length + 1));
  const lines = readLines(filePath);
  const content = lines.join("\n");
  const issues = [];

  if (/(?:node:)?child_process/u.test(content) && !allowedProcessRunnerFiles.has(relPath)) {
    issues.push(
      createIssue(
        "child-process-import",
        relPath,
        null,
        "Active runtime source imports child_process outside the C.next audited runner allowlist.",
      ),
    );
  }

  const allowedRunner = allowedProcessRunnerFiles.get(relPath);
  if (allowedRunner !== undefined) {
    for (const needle of allowedRunner.evidence) {
      if (!content.includes(needle)) {
        issues.push(
          createIssue(
            "runner-evidence-missing",
            relPath,
            null,
            `Audited ${allowedRunner.runnerKind} runner is missing required evidence needle: ${needle}`,
          ),
        );
      }
    }
    for (const companion of allowedRunner.companionEvidence ?? []) {
      const companionContent = readFileSync(resolve(repoRootPath, companion.file), "utf8");
      for (const needle of companion.needles) {
        if (!companionContent.includes(needle)) {
          issues.push(
            createIssue(
              "runner-companion-evidence-missing",
              relPath,
              null,
              `Audited ${allowedRunner.runnerKind} runner companion ${companion.file} is missing required evidence needle: ${needle}`,
            ),
          );
        }
      }
    }
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

  for (const term of blockedRunnerTerms) {
    lines.forEach((line, index) => {
      if (term.pattern.test(line) && !lineMatchesAllowance(relPath, line, term.allowedLines)) {
        issues.push(createIssue(term.id, relPath, index + 1, term.detail));
      }
    });
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/process\.kill\s*\(/u.test(line)) {
      const allowed = allowedProcessKillFiles.get(relPath);
      if (allowed === undefined || !content.includes(allowed.requiredNeedle)) {
        issues.push(
          createIssue(
            "process-kill",
            relPath,
            lineNumber,
            "process.kill is only allowed for signal-zero liveness probing in the Weixin store.",
          ),
        );
      }
    }

    if (/\.kill\s*\(/u.test(line) && !/process\.kill\s*\(/u.test(line)) {
      const allowed = allowedChildKillFiles.get(relPath);
      if (allowed === undefined || !content.includes(allowed.requiredNeedle)) {
        issues.push(
          createIssue(
            "child-process-kill",
            relPath,
            lineNumber,
            "Child process kill calls must be tied to owned-process timeout/close signal evidence.",
          ),
        );
      }
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

  if (
    content.includes("media-analysis-runner") &&
    !lineMatchesAllowance(relPath, content, auditedDryRunRunnerLines)
  ) {
    issues.push(
      createIssue(
        "media-analysis-runner-live-path",
        relPath,
        null,
        "media-analysis-runner may only appear as the audited local dry-run manifest until a live runner is explicitly admitted.",
      ),
    );
  }

  return issues;
}

function createFocusedSurfaceReport(repoRootPath, files) {
  const focusedSet = new Set(
    focusedRoots
      .map((root) => resolve(repoRootPath, root))
      .filter((root) => statExists(root))
      .flatMap((root) => walkSourceFiles(root))
      .map((file) => toPosixPath(file.slice(repoRootPath.length + 1))),
  );
  const scannedFocusedFiles = files.filter((file) => {
    const relPath = toPosixPath(file.slice(repoRootPath.length + 1));
    return focusedSet.has(relPath);
  });
  const counts = {
    processApis: 0,
    browserWindowFiles: 0,
    externalBrowserRunnerTerms: 0,
    mediaRunnerTerms: 0,
    notebookRunnerTerms: 0,
    sandboxCommandExecutionFiles: 0,
    processLedgerFiles: 0,
  };
  const filesBySignal = {
    processApis: new Set(),
    browserWindow: new Set(),
    externalBrowserRunnerTerms: new Set(),
    mediaRunnerTerms: new Set(),
    notebookRunnerTerms: new Set(),
    sandboxCommandExecution: new Set(),
    processLedger: new Set(),
  };

  for (const file of scannedFocusedFiles) {
    const relPath = toPosixPath(file.slice(repoRootPath.length + 1));
    const content = readFileSync(file, "utf8");
    if (
      /(?:node:)?child_process|\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/u.test(content)
    ) {
      counts.processApis += 1;
      filesBySignal.processApis.add(relPath);
    }
    if (/\bBrowserWindow\b/u.test(content)) {
      counts.browserWindowFiles += 1;
      filesBySignal.browserWindow.add(relPath);
    }
    if (/\b(?:playwright|chromium|puppeteer)\b/iu.test(content)) {
      counts.externalBrowserRunnerTerms += 1;
      filesBySignal.externalBrowserRunnerTerms.add(relPath);
    }
    if (/\b(?:ffmpeg|ffprobe|local-media-server|media-analysis-runner)\b/iu.test(content)) {
      counts.mediaRunnerTerms += 1;
      filesBySignal.mediaRunnerTerms.add(relPath);
    }
    if (/\b(?:jupyter|ipynb)\b/iu.test(content)) {
      counts.notebookRunnerTerms += 1;
      filesBySignal.notebookRunnerTerms.add(relPath);
    }
    if (/\bsandboxCommandExecution\b/u.test(content)) {
      counts.sandboxCommandExecutionFiles += 1;
      filesBySignal.sandboxCommandExecution.add(relPath);
    }
    if (/\bprocessCapabilityLedger\b/u.test(content)) {
      counts.processLedgerFiles += 1;
      filesBySignal.processLedger.add(relPath);
    }
  }

  return {
    scannedFocusedFiles: scannedFocusedFiles.length,
    counts,
    filesBySignal: Object.fromEntries(
      Object.entries(filesBySignal).map(([key, value]) => [key, [...value].sort()]),
    ),
    auditedElectronBrowserWindowFiles: Object.fromEntries(auditedElectronBrowserWindowFiles),
  };
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function createAuditedRunnerInventory(repoRootPath, files) {
  return [...allowedProcessRunnerFiles.entries()].map(([file, config]) => {
    const content = readFileSync(resolve(repoRootPath, file), "utf8");
    const missingEvidence = config.evidence.filter((needle) => !content.includes(needle));
    const missingCompanionEvidence = (config.companionEvidence ?? []).flatMap((companion) => {
      const companionContent = readFileSync(resolve(repoRootPath, companion.file), "utf8");
      return companion.needles
        .filter((needle) => !companionContent.includes(needle))
        .map((needle) => `${companion.file}:${needle}`);
    });
    return {
      file,
      runnerKind: config.runnerKind,
      status:
        missingEvidence.length === 0 && missingCompanionEvidence.length === 0
          ? "covered"
          : "evidence-missing",
      reason: config.reason,
      evidenceNeedles: config.evidence,
      companionEvidence: config.companionEvidence ?? [],
      missingEvidence: [...missingEvidence, ...missingCompanionEvidence],
      scanned: files.some(
        (candidate) => toPosixPath(candidate.slice(repoRootPath.length + 1)) === file,
      ),
    };
  });
}

const activeFiles = activeRoots
  .map((root) => resolve(repoRoot, root))
  .filter((root) => statExists(root))
  .flatMap((root) => walkSourceFiles(root));
const issues = activeFiles.flatMap((file) => scanProcessRunnerFile(repoRoot, file));
const auditedRunnerInventory = createAuditedRunnerInventory(repoRoot, activeFiles);
const focusedSurface = createFocusedSurfaceReport(repoRoot, activeFiles);
const inventoryIssues = auditedRunnerInventory.flatMap((item) =>
  item.status === "covered"
    ? []
    : [
        createIssue(
          "audited-runner-inventory",
          item.file,
          null,
          `Audited runner inventory is missing evidence: ${item.missingEvidence.join(", ")}`,
        ),
      ],
);
const allIssues = [...issues, ...inventoryIssues];

mkdirSync(resultsDir, { recursive: true });
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: allIssues.length === 0 ? "passed" : "failed",
    scannedFiles: activeFiles.length,
    auditedRunnerCount: auditedRunnerInventory.length,
    focusedFiles: focusedSurface.scannedFocusedFiles,
    issueCount: allIssues.length,
    migrationAction: allIssues.length === 0 ? "no-new-runner-to-migrate" : "migration-required",
    checks: {
      childProcessImports: "audited-runner-allowlist-only",
      externalBrowserRunners: "no-playwright-chromium-puppeteer-without-c13",
      mediaProcessRunners: "no-ffmpeg-ffprobe-local-media-server-without-c10-or-c13",
      notebookProcessRunners: "no-jupyter-or-ipynb-runner-without-c13",
      legacyCommandPrefixes: "fail-closed-reader-or-ledger-only",
      shellOpenExternal: "sandbox-backend-only",
      processSignals: "owned-process-evidence-only",
    },
  },
  scannedRoots: activeRoots,
  focusedRoots,
  auditedRunnerInventory,
  focusedSurface,
  allowlists: {
    processRunnerFiles: Object.fromEntries(
      [...allowedProcessRunnerFiles.entries()].map(([file, config]) => [file, config.reason]),
    ),
    shellOpenExternalFiles: Object.fromEntries(allowedShellOpenExternalFiles),
    processKillFiles: Object.fromEntries(
      [...allowedProcessKillFiles.entries()].map(([file, config]) => [file, config.reason]),
    ),
    childKillFiles: Object.fromEntries(
      [...allowedChildKillFiles.entries()].map(([file, config]) => [file, config.reason]),
    ),
  },
  requiredMigrationPolicy: {
    shortCommandRunners: "Use C.10 sandboxCommandExecution with exact allowedCommandPatterns.",
    longLivedRunners:
      "Use C.13 long-lived process admission with process signal evidence and process ledger entries.",
    browserAutomation:
      "Do not add unmanaged Playwright/Chromium/Puppeteer processes; keep Electron BrowserWindow surfaces audited unless a sandbox-owned runner is added.",
    mediaAutomation:
      "Do not add unmanaged ffmpeg/ffprobe/local-media-server processes; migrate through Agent OS sandbox executor first.",
    notebookAutomation:
      "Do not add unmanaged Notebook/Jupyter processes; migrate through Agent OS long-lived contract first.",
  },
  issues: allIssues,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS runner scan migration batch gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Scanned ${report.summary.scannedFiles} files, audited runners ${report.summary.auditedRunnerCount}, issues ${report.summary.issueCount}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

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
