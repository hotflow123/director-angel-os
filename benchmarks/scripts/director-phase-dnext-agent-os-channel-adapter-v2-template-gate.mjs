import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-dnext-agent-os-channel-adapter-v2-template-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "channel-adapter-v2-template-contract",
    path: "packages/channels-core/src/channel-adapter-contract.ts",
    needles: [
      "CHANNEL_ADAPTER_V2_TEMPLATE_SCHEMA_ID",
      "ChannelAdapterV2Template",
      "ChannelAdapterRuntimeBindingContract",
      "defineChannelAdapterV2Template",
      "createChannelAdapterV2TemplateReport",
      "createSecondChannelAdapterV2Template",
      "second-channel-template",
      "usesUnifiedConversationRuntime",
      "forbidsChannelSpecificToolSideDoor",
      "requiresSharedToolExecutor",
      "noCredentialProfileAccessWithoutOperatorScope",
      "runtime.usesDynamicCapabilityContext",
    ],
  },
  {
    id: "channels-core-export",
    path: "packages/channels-core/src/index.ts",
    needles: [
      "createSecondChannelAdapterV2Template",
      "defineChannelAdapterV2Template",
      "createChannelAdapterV2TemplateReport",
      "ChannelAdapterV2Template",
      "ChannelAdapterRuntimeBindingContract",
    ],
  },
  {
    id: "channel-adapter-v2-tests",
    path: "packages/channels-core/tests/channel-adapter-contract.test.ts",
    needles: [
      "creates a second-channel adapter v2 template on the shared runtime contract",
      "rejects channel adapter v2 templates with tool side doors",
      "second-channel-template",
      "forbidsChannelSpecificToolSideDoor",
      "requiresSharedToolExecutor",
    ],
  },
  {
    id: "release-registration",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: ["director-phase-dnext-agent-os-channel-adapter-v2-template-gate"],
  },
];

const requiredPackageScripts = [
  {
    id: "benchmarks-package-script",
    path: "benchmarks/package.json",
    needle:
      '"bench:director-agent-os-channel-adapter-v2-template": "node ./scripts/director-phase-dnext-agent-os-channel-adapter-v2-template-gate.mjs"',
  },
  {
    id: "root-package-script",
    path: "package.json",
    needle:
      '"bench:director-agent-os-channel-adapter-v2-template": "pnpm --dir benchmarks bench:director-agent-os-channel-adapter-v2-template"',
  },
  {
    id: "wave-manifest",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needle: "director-phase-dnext-agent-os-channel-adapter-v2-template-gate",
  },
  {
    id: "release-suite-coverage",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needle: "channel-adapter-v2-template",
  },
  {
    id: "benchmark-readme",
    path: "benchmarks/README.md",
    needle: "bench:director-agent-os-channel-adapter-v2-template",
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

function evaluateNoSideDoorSource() {
  const text = readText("packages/channels-core/src/channel-adapter-contract.ts");
  const forbidden = [
    "child_process",
    "spawn(",
    "exec(",
    "openExternal",
    "Playwright",
    "puppeteer",
    "chromium.launch",
  ];
  const hits = forbidden.filter((needle) => text.includes(needle));
  return {
    id: "no-channel-specific-tool-side-door-source",
    path: "packages/channels-core/src/channel-adapter-contract.ts",
    status: hits.length === 0 ? "passed" : "failed",
    missingNeedles: hits.map((hit) => `forbidden:${hit}`),
  };
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = [
  ...evaluateNeedleCoverage(requiredSourceCoverage),
  evaluateNoSideDoorSource(),
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
    note: "D.next proves a second non-desktop/non-weixin channel adapter v2 template is bound to the shared runtime contract and forbids channel-specific tool side doors.",
  },
  sourceCoverage,
  registrationCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS channel adapter v2 template gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, registration coverage: ${report.summary.registrationCoveragePassed}/${report.summary.registrationCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS channel adapter v2 template gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
