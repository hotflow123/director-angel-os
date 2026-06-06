import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredArtifactRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-evidence-artifact-latest.json";

const requiredSourceCoverage = [
  {
    id: "agent-os-all-desktop-smoke-evidence-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
      "function createDesktopSmokeEvidenceArtifact",
      "const desktopSmokeEvidenceArtifact",
      "desktopSmokeEvidenceArtifact,",
      "desktopSmokeEvidenceArtifactPath",
      '"director.agent-os.desktop-smoke-evidence-artifact.v1"',
      '"local-operator-owned-dry-run-metadata"',
      "desktopAutomationStarted: false",
      "userDataRead: false",
      "runnerIntentTokenIssued: false",
    ],
  },
  {
    id: "release-suite-desktop-smoke-evidence-artifact-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact",
      "desktop-smoke-evidence-artifact",
      "expectedDesktopSmokeEvidenceArtifactBenchmarkScript",
      "expectedDesktopSmokeEvidenceArtifactRootScript",
      "bench:director-agent-os-desktop-smoke-evidence-artifact",
    ],
  },
  {
    id: "manifest-desktop-smoke-evidence-artifact-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
      "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact",
      "Phase I.1 gate proving the desktop smoke evidence artifact writer only emits local dry-run metadata",
    ],
  },
  {
    id: "package-desktop-smoke-evidence-artifact-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-desktop-smoke-evidence-artifact"',
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact",
    ],
  },
  {
    id: "benchmarks-package-desktop-smoke-evidence-artifact-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-desktop-smoke-evidence-artifact"',
      "node ./scripts/director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate.mjs",
    ],
  },
  {
    id: "remaining-execution-desktop-smoke-evidence-artifact-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] I.1 最小桌面 smoke evidence artifact 写入器",
      "operator-owned 的本地 dry-run/smoke metadata artifact",
      "不读取用户数据",
      "不启动微信/provider/browser 自动化",
      "不启动 live runner",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-desktop-smoke-evidence-artifact-report",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.schemaVersion ===
        "director.agent-os.desktop-smoke-evidence-artifact.v1",
      (report) => report?.desktopSmokeEvidenceArtifact?.summary?.artifactWrittenCount === 1,
      (report) => report?.desktopSmokeEvidenceArtifact?.summary?.userDataReadCount === 0,
      (report) => report?.desktopSmokeEvidenceArtifact?.summary?.liveRunnerStartedCount === 0,
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.artifact?.artifactMode ===
        "local-operator-owned-dry-run-metadata",
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.artifact?.checkId ===
        "real-desktop-device-release-smoke",
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.dryRunOnly === true,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.localOnly === true,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.userDataRead === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.manifestContentRead === false,
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.artifact?.desktopAutomationStarted === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.weixinAutomationStarted === false,
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.artifact?.providerAutomationStarted === false,
      (report) =>
        report?.desktopSmokeEvidenceArtifact?.artifact?.browserAutomationStarted === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.liveRunnerStarted === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.runnerIntentUnlocked === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.runnerIntentTokenIssued === false,
      (report) => report?.desktopSmokeEvidenceArtifact?.artifact?.runnerIntentSigned === false,
      (report) =>
        String(report?.desktopSmokeEvidenceArtifact?.artifactPath ?? "").endsWith(
          requiredArtifactRelativePath,
        ),
    ],
  },
  {
    id: "desktop-smoke-evidence-artifact-file",
    path: requiredArtifactRelativePath,
    checks: [
      (artifact) =>
        artifact?.schemaVersion === "director.agent-os.desktop-smoke-evidence-artifact-file.v1",
      (artifact) => artifact?.artifactMode === "local-operator-owned-dry-run-metadata",
      (artifact) => artifact?.checkId === "real-desktop-device-release-smoke",
      (artifact) => artifact?.dryRunOnly === true,
      (artifact) => artifact?.localOnly === true,
      (artifact) => artifact?.userDataRead === false,
      (artifact) => artifact?.manifestContentRead === false,
      (artifact) => artifact?.desktopAutomationStarted === false,
      (artifact) => artifact?.weixinAutomationStarted === false,
      (artifact) => artifact?.providerAutomationStarted === false,
      (artifact) => artifact?.browserAutomationStarted === false,
      (artifact) => artifact?.liveRunnerStarted === false,
      (artifact) => artifact?.runnerIntentTokenIssued === false,
      (artifact) => artifact?.runnerIntentSigned === false,
      (artifact) => artifact?.nextStep === "desktop-smoke-manual-run-checklist-artifact-validator",
    ],
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

function createDesktopSmokeEvidenceArtifactReport(artifact) {
  return {
    schemaVersion: "director.agent-os.desktop-smoke-evidence-artifact.v1",
    status: artifact?.status === "ready" ? "ready" : "blocked",
    artifactPath: resolve(repoRoot, requiredArtifactRelativePath),
    artifactRelativePath: requiredArtifactRelativePath,
    summary: {
      artifactWrittenCount: artifact === null ? 0 : 1,
      userDataReadCount: artifact?.userDataRead === true ? 1 : 0,
      manifestContentReadCount: artifact?.manifestContentRead === true ? 1 : 0,
      desktopAutomationStartedCount: artifact?.desktopAutomationStarted === true ? 1 : 0,
      weixinAutomationStartedCount: artifact?.weixinAutomationStarted === true ? 1 : 0,
      providerAutomationStartedCount: artifact?.providerAutomationStarted === true ? 1 : 0,
      browserAutomationStartedCount: artifact?.browserAutomationStarted === true ? 1 : 0,
      liveRunnerStartedCount: artifact?.liveRunnerStarted === true ? 1 : 0,
      runnerIntentTokenIssuedCount: artifact?.runnerIntentTokenIssued === true ? 1 : 0,
      runnerIntentSignedCount: artifact?.runnerIntentSigned === true ? 1 : 0,
    },
    artifact,
  };
}

function resolveDesktopSmokeEvidenceArtifactReport(report) {
  if (report?.desktopSmokeEvidenceArtifact) {
    return report;
  }
  const artifact = readJsonOrNull(requiredArtifactRelativePath);
  return {
    ...(report ?? { suiteId: "director-agent-os-all-gate" }),
    desktopSmokeEvidenceArtifact: createDesktopSmokeEvidenceArtifactReport(artifact),
  };
}

function evaluateSourceCoverage() {
  return requiredSourceCoverage.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null
        ? item.needles.filter((needle) => !text.includes(needle))
        : item.needles;
    return {
      id: item.id,
      path: item.path,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function evaluateArtifactCoverage() {
  return requiredArtifactCoverage.map((item) => {
    const artifactPath = resolve(repoRoot, item.path);
    const artifactExists = existsSync(artifactPath);
    const artifact = artifactExists ? readJsonOrNull(item.path) : null;
    const subject =
      item.id === "agent-os-all-latest-desktop-smoke-evidence-artifact-report"
        ? resolveDesktopSmokeEvidenceArtifactReport(artifact)
        : artifact;
    const failedChecks = item.checks
      .map((check, index) => ({ index, passed: check(subject) }))
      .filter((check) => !check.passed)
      .map((check) => `check-${check.index}`);
    return {
      id: item.id,
      path: item.path,
      status: artifactExists && failedChecks.length === 0 ? "passed" : "failed",
      artifactExists,
      failedChecks,
    };
  });
}

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = evaluateSourceCoverage();
const artifactCoverage = evaluateArtifactCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedArtifactCoverage = artifactCoverage.filter((result) => result.status !== "passed");
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  status:
    failedSourceCoverage.length === 0 && failedArtifactCoverage.length === 0 ? "passed" : "failed",
  summary: {
    sourceCoverage: sourceCoverage.length - failedSourceCoverage.length,
    requiredSourceCoverage: sourceCoverage.length,
    artifactCoverage: artifactCoverage.length - failedArtifactCoverage.length,
    requiredArtifactCoverage: artifactCoverage.length,
    failed: failedSourceCoverage.length + failedArtifactCoverage.length,
  },
  sourceCoverage,
  artifactCoverage,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS desktop smoke evidence artifact gate completed: ${report.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoverage}/${report.summary.requiredSourceCoverage}, artifact coverage: ${report.summary.artifactCoverage}/${report.summary.requiredArtifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (report.status !== "passed") {
  const sourceDetails = failedSourceCoverage
    .map((result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`)
    .join("\n");
  const artifactDetails = failedArtifactCoverage
    .map((result) => `${result.id} failed ${result.failedChecks.join(", ")} in ${result.path}`)
    .join("\n");
  fail(
    "Director Agent OS desktop smoke evidence artifact gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
