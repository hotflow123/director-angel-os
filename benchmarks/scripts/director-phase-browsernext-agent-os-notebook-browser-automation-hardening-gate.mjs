import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".codex-backups",
  ".git",
  ".turbo",
  "dist",
  "node_modules",
  "参考仓库",
]);
const activeRoots = ["apps", "packages", "services", "internal-plugins"];

const requiredSourceCoverage = [
  {
    id: "browser-extension-hardening-contract-source",
    path: "packages/agent-os-extensions/src/index.ts",
    needles: [
      "automationHardening",
      'runnerImplementation: "electron-browser-window"',
      "externalProcessRunner: false",
      'credentialProfileAccess: "operator-scope-required"',
      "unmanagedPlaywrightChromiumProcess: false",
    ],
  },
  {
    id: "browser-extension-hardening-contract-test",
    path: "packages/agent-os-extensions/tests/extension-manifest.test.ts",
    needles: [
      "declares Browser.next hardening metadata for desktop browser automation",
      "electron-browser-window",
      "operator-scope-required",
      "unmanagedPlaywrightChromiumProcess: false",
    ],
  },
  {
    id: "notebook-provider-hardening-contract-source",
    path: "packages/conversation-runtime/src/external-tools.ts",
    needles: [
      "createExternalToolProviderAutomationHardening",
      'credentialProfileAccess: "operator-scope-required"',
      "unmanagedPlaywrightChromiumProcess: false",
      'providerRunnerStatus: "not-configured"',
      "operatorScopeRequired: true",
    ],
  },
  {
    id: "notebook-provider-hardening-contract-test",
    path: "packages/conversation-runtime/tests/external-tools.test.ts",
    needles: [
      "adds Browser.next hardening metadata to browser and notebook provider presets",
      'credentialProfileAccess: "operator-scope-required"',
      'providerRunnerStatus: "not-configured"',
      "operatorScopeRequired: true",
    ],
  },
];

const requiredRuntimeSurfaceCoverage = [
  {
    id: "desktop-browser-window-sandbox",
    path: "apps/director-desktop/src/desktop-browser-tool-service.js",
    needles: [
      "BrowserWindow",
      "partition",
      "contextIsolation: true",
      "nodeIntegration: false",
      "sandbox: true",
      "assertBrowserNavigationAllowed",
    ],
  },
  {
    id: "desktop-browser-learning-window-sandbox",
    path: "apps/director-desktop/src/desktop-browser-fetch.js",
    needles: [
      "BrowserWindow",
      "partition: options.partition",
      "contextIsolation: true",
      "nodeIntegration: false",
      "sandbox: true",
    ],
  },
  {
    id: "desktop-browser-agent-os-direct-invoke",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "invokeDesktopBrowserDesktopAgentOsExtension",
      "createBuiltinBrowserToolExecutors",
      "browser.desktop",
      "readDesktopBrowserAgentOsToolName",
    ],
  },
  {
    id: "weixin-browser-operator-endpoint-gate",
    path: "apps/weixin-gateway/src/adapter.ts",
    needles: [
      "DIRECTOR_BROWSER_TOOL_URL",
      "createWeixinSharedDesktopBrowserProvider",
      "mapWeixinBrowserEndpointToModelToolDoctor",
    ],
  },
];

const blockedTerms = [
  {
    id: "unmanaged-playwright",
    pattern: /\bplaywright\b/iu,
    allow: [
      {
        path: "apps/director-desktop/src/desktop-system-handlers.js",
        includes: "vitest|jest|playwright|e2e",
      },
      {
        path: "packages/skills/src/reference-import.ts",
        includes: '[/browser|playwright|chromium/u, "browser"]',
      },
      {
        path: "benchmarks/scripts/director-phase-cnext-agent-os-runner-scan-migration-batch-gate.mjs",
        includes: "Skill reference import tool classifier",
      },
    ],
    detail: "Playwright cannot be introduced as an unmanaged browser automation process.",
  },
  {
    id: "unmanaged-chromium",
    pattern: /\bchromium\b/iu,
    allow: [
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "/Applications/Chromium.app/Contents/MacOS/Chromium",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "No Chromium-based browser executable was found.",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "安装 Google Chrome、Chromium、Brave 或 Edge 后再启动 Angel Chrome",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: '"chromium.exe"',
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: '"chromium-browser"',
      },
      {
        path: "packages/conversation-runtime/src/opencli-tools.ts",
        includes: 'text.includes("please open chromium")',
      },
      {
        path: "packages/skills/src/reference-import.ts",
        includes: '[/browser|playwright|chromium/u, "browser"]',
      },
      {
        path: "benchmarks/scripts/director-phase-cnext-agent-os-runner-scan-migration-batch-gate.mjs",
        includes: "Skill reference import tool classifier",
      },
    ],
    detail: "Chromium cannot be introduced as an unmanaged browser automation process.",
  },
  {
    id: "unmanaged-puppeteer",
    pattern: /\bpuppeteer\b/iu,
    allow: [],
    detail: "Puppeteer cannot be introduced as an unmanaged browser automation process.",
  },
  {
    id: "notebook-user-profile-side-door",
    pattern: /\b(?:browserProfile|profilePath|userDataDir|cookiesPath|credentialProfile)\b/u,
    allow: [
      {
        path: "apps/director-desktop/scripts/launch-visible-electron.mjs",
        includes: "userDataDir = join(workspaceRoot",
      },
      {
        path: "apps/director-desktop/scripts/launch-visible-electron.mjs",
        includes: "singletonLockPath = join(userDataDir",
      },
      {
        path: "apps/director-desktop/scripts/launch-visible-electron.mjs",
        includes: "mkdirSync(userDataDir",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "DEFAULT_ANGEL_CHROME_USER_DATA_DIR",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "userDataDir,",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "userDataDir: angelChromeUserDataDir",
      },
      {
        path: "apps/director-desktop/src/desktop-browser-tool-service.js",
        includes: "normalizedUserDataDir",
      },
      {
        path: "apps/weixin-gateway/src/adapter.ts",
        includes: 'browserProfile?: "angel" | "user" | "electron" | (string & {});',
      },
      {
        path: "apps/weixin-gateway/src/adapter.ts",
        includes: "input.browserProfile",
      },
      {
        path: "packages/conversation-runtime/src/url-learning-orchestrator.ts",
        includes: 'browserProfile?: "angel" | "user" | "electron" | (string & {});',
      },
      {
        path: "packages/conversation-runtime/src/url-learning-orchestrator.ts",
        includes: "resolveBrowserProfile(input.userText)",
      },
    ],
    detail:
      "Notebook/browser automation must not read credential/profile paths without operator scope.",
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

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function fileIncludesAll(path, needles) {
  const content = readText(path);
  return needles
    .filter((needle) => !content.includes(needle))
    .map((needle) => `${path} missing ${needle}`);
}

function isAllowedLine(relPath, line, allow) {
  return allow.some((entry) => entry.path === relPath && line.includes(entry.includes));
}

function scanBlockedTerms(files) {
  const issues = [];
  for (const file of files) {
    const relPath = toPosixPath(file.slice(repoRoot.length + 1));
    const lines = readFileSync(file, "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const blocked of blockedTerms) {
        if (blocked.pattern.test(line) && !isAllowedLine(relPath, line, blocked.allow)) {
          issues.push({
            rule: blocked.id,
            file: relPath,
            line: index + 1,
            detail: blocked.detail,
          });
        }
      }
    });
  }
  return issues;
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const activeFiles = activeRoots
  .map((root) => resolve(repoRoot, root))
  .filter((root) => statExists(root))
  .flatMap((root) => walkSourceFiles(root));
const sourceCoverageFailures = requiredSourceCoverage.flatMap((item) =>
  fileIncludesAll(item.path, item.needles).map((detail) => ({
    rule: "source-coverage",
    file: item.path,
    line: null,
    detail,
  })),
);
const runtimeSurfaceFailures = requiredRuntimeSurfaceCoverage.flatMap((item) =>
  fileIncludesAll(item.path, item.needles).map((detail) => ({
    rule: "runtime-surface",
    file: item.path,
    line: null,
    detail,
  })),
);
const blockedTermIssues = scanBlockedTerms(activeFiles);
const issues = [...sourceCoverageFailures, ...runtimeSurfaceFailures, ...blockedTermIssues];

mkdirSync(resultsDir, { recursive: true });
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: issues.length === 0 ? "passed" : "failed",
    scannedFiles: activeFiles.length,
    sourceCoverageChecks: requiredSourceCoverage.length,
    runtimeSurfaceChecks: requiredRuntimeSurfaceCoverage.length,
    issueCount: issues.length,
    hardening: {
      browserDesktopRunner: "electron-browser-window",
      unmanagedBrowserProcessAllowed: false,
      notebookRunnerStatus: "not-configured",
      credentialProfileAccess: "operator-scope-required",
    },
  },
  requiredSourceCoverage,
  requiredRuntimeSurfaceCoverage,
  blockedTerms: blockedTerms.map((blocked) => ({
    id: blocked.id,
    detail: blocked.detail,
  })),
  issues,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS notebook/browser automation hardening gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Scanned ${report.summary.scannedFiles} files, issues ${report.summary.issueCount}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (issues.length > 0) {
  for (const issue of issues.slice(0, 20)) {
    process.stderr.write(
      `${issue.rule}: ${issue.file}${issue.line === null ? "" : `:${issue.line}`} ${issue.detail}\n`,
    );
  }
  if (issues.length > 20) {
    process.stderr.write(`... ${issues.length - 20} more issues\n`);
  }
  process.exitCode = 1;
}
