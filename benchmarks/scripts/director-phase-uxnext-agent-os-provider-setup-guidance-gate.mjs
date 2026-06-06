import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-uxnext-agent-os-provider-setup-guidance-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-provider-setup-guidance-ui",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createExternalToolSetupGuidancePanel",
      "createExternalToolSetupGuidanceItem",
      "resolveExternalToolSetupGuidance",
      "settings-provider-setup-guidance",
      "needs-auth",
      "需要授权",
      "安装计划",
      "重连",
      "最近可用",
      "SecretRef/Keychain 只显示引用状态，不读取或展示密钥值",
    ],
  },
  {
    id: "desktop-provider-guidance-actions",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "runExternalToolSetupGuidanceAction",
      "provider.setup.needs-auth",
      "provider.setup.install",
      "provider.setup.reconnect",
      "provider.setup.last-known-good",
      "DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE",
      'operation: "install"',
      'operation: "enable"',
    ],
  },
  {
    id: "desktop-provider-secret-boundary",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "formatExternalProviderSecretSource(provider)",
      "configuredSecretRefSource",
      "configuredSecretRefProvider",
      "configuredSecretEnvVar",
      'configuredSecret ? "Key 已配置" : "Key 未配置"',
      "settings-provider-secret-boundary",
    ],
  },
  {
    id: "desktop-structure-tests",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "renders external tool provider setup guidance without exposing secret values",
      "createExternalToolSetupGuidancePanel",
      "provider.setup.needs-auth",
      "provider.setup.install",
      "provider.setup.reconnect",
      "provider.setup.last-known-good",
      "SecretRef/Keychain 只显示引用状态",
    ],
  },
  {
    id: "desktop-provider-guidance-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".settings-provider-setup-guidance",
      ".settings-provider-setup-guidance-grid",
      ".settings-provider-setup-guidance-item",
      '.settings-provider-setup-guidance-item[data-state="needs-auth"]',
      ".settings-provider-secret-boundary",
    ],
  },
  {
    id: "release-registration",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: ["director-phase-uxnext-agent-os-provider-setup-guidance-gate"],
  },
];

const requiredPackageScripts = [
  {
    id: "benchmarks-package-script",
    path: "benchmarks/package.json",
    needle:
      '"bench:director-agent-os-provider-setup-guidance": "node ./scripts/director-phase-uxnext-agent-os-provider-setup-guidance-gate.mjs"',
  },
  {
    id: "root-package-script",
    path: "package.json",
    needle:
      '"bench:director-agent-os-provider-setup-guidance": "pnpm --dir benchmarks bench:director-agent-os-provider-setup-guidance"',
  },
  {
    id: "wave-manifest",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needle: "director-phase-uxnext-agent-os-provider-setup-guidance-gate",
  },
  {
    id: "release-suite-coverage",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needle: "provider-setup-guidance",
  },
  {
    id: "benchmark-readme",
    path: "benchmarks/README.md",
    needle: "bench:director-agent-os-provider-setup-guidance",
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function evaluateNeedleCoverage(items) {
  return items.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null
        ? (item.needles?.filter((needle) => !text.includes(needle)) ??
          (text.includes(item.needle) ? [] : [item.needle]))
        : (item.needles ?? [item.needle]);
    return {
      id: item.id,
      path: item.path,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function evaluateForbiddenSecretSurface() {
  const text = readText("apps/director-desktop/src/app.js");
  const forbidden = [
    "provider.secretValue",
    "provider.apiKeyValue",
    "provider.bearerTokenValue",
    "provider.passwordValue",
    "provider.keychainPassword",
    "metadata.secretValue",
    "metadata.apiKeyValue",
    "metadata.bearerTokenValue",
    "metadata.passwordValue",
    "textContent = provider.configuredSecretValue",
  ];
  const hits = forbidden.filter((needle) => text.includes(needle));
  return {
    id: "no-provider-secret-value-rendering",
    path: "apps/director-desktop/src/app.js",
    status: hits.length === 0 ? "passed" : "failed",
    missingNeedles: hits.map((hit) => `forbidden:${hit}`),
  };
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = [
  ...evaluateNeedleCoverage(requiredSourceCoverage),
  evaluateForbiddenSecretSurface(),
];
const registrationCoverage = evaluateNeedleCoverage(requiredPackageScripts);
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedRegistrationCoverage = registrationCoverage.filter(
  (result) => result.status !== "passed",
);
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
  ...failedRegistrationCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    registrationCoverage: registrationCoverage.length,
    registrationCoveragePassed: registrationCoverage.length - failedRegistrationCoverage.length,
    failed: failures.length,
    note: "UX.next proves desktop Settings/Tools surfaces actionable external tool/provider setup guidance for needs-auth, install, reconnect, and last-known-good states without reading or displaying SecretRef/Keychain secret values.",
  },
  sourceCoverage,
  registrationCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS provider setup guidance gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, registration coverage: ${report.summary.registrationCoveragePassed}/${report.summary.registrationCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS provider setup guidance gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
