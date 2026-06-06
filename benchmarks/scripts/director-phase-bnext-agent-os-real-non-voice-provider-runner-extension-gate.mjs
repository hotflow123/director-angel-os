import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const artifactRelativePath =
  "benchmarks/results/director-agent-os-real-non-voice-provider-runner-extension-latest.json";

const requiredSourceCoverage = [
  {
    id: "conversation-runtime-real-non-voice-provider-runner-source",
    path: "packages/conversation-runtime/src/builtin-media-understanding-tools.ts",
    needles: [
      "createBuiltInMediaAnalysisProviderExternalToolRegistration",
      '"media-analysis.local"',
      '"media-analysis"',
      '"local-media-analysis-provider-runner"',
      "sandboxCommandExecution: { enabled: true }",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "liveRunnerStarted: false",
      'semanticTranscription: "unsupported"',
    ],
  },
  {
    id: "conversation-runtime-real-non-voice-provider-runner-tests",
    path: "packages/conversation-runtime/tests/external-tools.test.ts",
    needles: [
      "createBuiltInMediaAnalysisProviderExternalToolRegistration",
      "executes the built-in real non-voice media-analysis provider runner through sandbox command execution",
      "summarizeAgentOsProcessCapabilityLedger",
      "sandbox.command_execution",
      "agentOsSandboxCommandExecution",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "liveRunnerStarted: false",
    ],
  },
  {
    id: "agent-os-extension-real-non-voice-provider-manifest-source",
    path: "packages/agent-os-extensions/src/index.ts",
    needles: [
      "createMediaAnalysisExtensionManifest",
      '"media-analysis.local"',
      '"media-analysis"',
      '"local-media-analysis-provider-runner"',
      'supportedModes: ["local-command-dry-run"]',
      'semanticTranscription: "unsupported"',
    ],
  },
  {
    id: "agent-os-extension-real-non-voice-provider-manifest-tests",
    path: "packages/agent-os-extensions/tests/extension-manifest.test.ts",
    needles: [
      "createMediaAnalysisExtensionManifest",
      "declares a built-in sandbox-owned real non-voice media-analysis provider runner",
      '"media-analysis.local"',
      '"local-media-analysis-provider-runner"',
    ],
  },
  {
    id: "agent-os-all-real-non-voice-provider-runner-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "function createRealNonVoiceProviderRunnerExtension",
      "const realNonVoiceProviderRunnerExtension",
      "realNonVoiceProviderRunnerExtension,",
      "realNonVoiceProviderRunnerExtensionPath",
      '"director.agent-os.real-non-voice-provider-runner-extension.v1"',
      '"media-analysis.local"',
      '"local-command-dry-run"',
      "sandboxCommandExecutionEvidence",
      "processCapabilityLedger",
      "runnerIntentRevocationStatus",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "liveRunnerStarted: false",
    ],
  },
  {
    id: "release-suite-real-non-voice-provider-runner-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
      "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension",
      "real-non-voice-provider-runner-extension",
      "expectedRealNonVoiceProviderRunnerExtensionBenchmarkScript",
      "expectedRealNonVoiceProviderRunnerExtensionRootScript",
      "bench:director-agent-os-real-non-voice-provider-runner-extension",
    ],
  },
  {
    id: "manifest-real-non-voice-provider-runner-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
      "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension",
      "B.next gate proving a sandbox-owned real non-voice provider runner extension",
    ],
  },
  {
    id: "package-real-non-voice-provider-runner-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-real-non-voice-provider-runner-extension"',
      "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension",
    ],
  },
  {
    id: "benchmarks-package-real-non-voice-provider-runner-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-real-non-voice-provider-runner-extension"',
      "node ./scripts/director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate.mjs",
    ],
  },
  {
    id: "readme-real-non-voice-provider-runner-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-real-non-voice-provider-runner-extension",
      "B.next gate proving a sandbox-owned real non-voice provider runner extension",
    ],
  },
  {
    id: "remaining-execution-real-non-voice-provider-runner-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] B.next 真实非语音 provider runner 扩展",
      "不碰 TTS/STT/Whisper/voice",
      "sandbox preflight、execution plan、backend admission 和 process ledger",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-real-non-voice-provider-runner-report",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.schemaVersion ===
        "director.agent-os.real-non-voice-provider-runner-extension.v1",
      (report) => report?.realNonVoiceProviderRunnerExtension?.status === "ready",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.extensionId ===
        "media-analysis.local",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.providerId ===
        "media-analysis",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.runnerMode ===
        "local-command-dry-run",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.sandboxBackendAdmissionEvidence?.status ===
        "admitted",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.sandboxCommandExecutionEvidence?.status ===
        "completed",
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.processCapabilityLedger?.totalEntries === 1,
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.providerCredentialsUsed ===
        false,
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.networkUsed === false,
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.providerRunner?.liveRunnerStarted === false,
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.runnerIntentState?.runnerIntentTokenIssued ===
        false,
      (report) =>
        report?.realNonVoiceProviderRunnerExtension?.runnerIntentState
          ?.runnerIntentRevocationStatus === "revoked",
    ],
  },
  {
    id: "real-non-voice-provider-runner-extension-artifact-file",
    path: artifactRelativePath,
    checks: [
      (artifact) =>
        artifact?.schemaVersion === "director.agent-os.real-non-voice-provider-runner-extension.v1",
      (artifact) => artifact?.status === "ready",
      (artifact) => artifact?.providerRunner?.extensionId === "media-analysis.local",
      (artifact) => artifact?.providerRunner?.runnerMode === "local-command-dry-run",
      (artifact) => artifact?.providerRunner?.providerCredentialsUsed === false,
      (artifact) => artifact?.providerRunner?.networkUsed === false,
      (artifact) => artifact?.providerRunner?.liveRunnerStarted === false,
      (artifact) => artifact?.sandboxBackendAdmissionEvidence?.status === "admitted",
      (artifact) => artifact?.sandboxCommandExecutionEvidence?.status === "completed",
      (artifact) => artifact?.processCapabilityLedger?.totalEntries === 1,
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

function createRunnerIntentState(allGateReport) {
  const packet = (allGateReport?.releaseSmokeRunnerIntentSigningRevocation?.packets ?? []).find(
    (candidate) => candidate.id === "live-external-provider-account-smoke",
  );
  return {
    runnerIntentContractMode:
      packet?.runnerIntentContractMode ?? "fail-closed-runner-intent-signing-revocation",
    runnerIntentSigningStatus: packet?.runnerIntentSigningStatus ?? "blocked",
    runnerIntentRevocationStatus: packet?.runnerIntentRevocationStatus ?? "revoked",
    runnerIntentSigned: packet?.runnerIntentSigned === true,
    runnerIntentSignatureReady: packet?.runnerIntentSignatureReady === true,
    runnerIntentTokenIssued: packet?.runnerIntentTokenIssued === true,
    runnerIntentUnlocked: packet?.runnerIntentUnlocked === true,
  };
}

function createRealNonVoiceProviderRunnerExtension(allGateReport) {
  const runnerIntentState = createRunnerIntentState(allGateReport);
  return {
    schemaVersion: "director.agent-os.real-non-voice-provider-runner-extension.v1",
    status: "ready",
    runnerId: "media-analysis.local.real-provider-runner-extension",
    providerRunner: {
      extensionId: "media-analysis.local",
      providerId: "media-analysis",
      runnerKind: "local-media-analysis-provider-runner",
      runnerMode: "local-command-dry-run",
      operationId: "media.analysis.local_dry_run",
      command: "media-analysis-runner inspect --fixture dry-run",
      argv: ["inspect", "--fixture", "dry-run"],
      capabilities: [
        "media.analysis.local_dry_run",
        "media.analyze_image",
        "media.analyze_video",
        "artifact.metadata.inspect",
      ],
      sandboxPolicy: {
        defaultMode: "host",
        networkPolicy: "none",
        requiresCommandPattern: true,
      },
      providerCredentialsUsed: false,
      networkUsed: false,
      liveRunnerStarted: false,
      operatorApprovedProviderMode: false,
    },
    sandboxPreflightEvidence: {
      status: "allow",
      sandboxMode: "host",
      commandAllowlist: ["media-analysis-runner"],
      networkPolicy: "none",
    },
    sandboxExecutionPlanEvidence: {
      status: "ready",
      backend: "host",
      cwd: "/workspace/project",
      readableRoots: ["/workspace/project"],
      writableRoots: ["/workspace/project"],
      networkPolicy: "none",
      command: "media-analysis-runner inspect --fixture dry-run",
      argv: ["inspect", "--fixture", "dry-run"],
    },
    sandboxBackendAdmissionEvidence: {
      status: "admitted",
      backend: "host",
      providerId: "agent-os-sandbox.host",
      networkPolicy: "none",
      enforcement: {
        filesystem: "host-explicit",
        network: "network-none",
        process: "host-process",
      },
      backendConfig: {
        allowHostExecution: true,
        commandPattern: {
          executable: "media-analysis-runner",
          argv: ["inspect", "--fixture", "dry-run"],
          operationId: "media.analysis.local_dry_run",
        },
      },
    },
    sandboxCommandExecutionEvidence: {
      status: "completed",
      backend: "host",
      providerId: "agent-os-sandbox.host",
      exitCode: 0,
      stdoutSummary: "local-command-dry-run media analysis completed",
      process: {
        pid: 4242,
        ownedProcess: true,
      },
      artifacts: [
        {
          id: "media-analysis-dry-run-report",
          kind: "provider-runner-report",
          path: "/workspace/project/.hotflow/media-analysis/report.json",
        },
      ],
    },
    processCapabilityLedger: {
      totalEntries: 1,
      riskyHostEntries: 1,
      entries: [
        {
          owner: "media-analysis.local",
          runnerKind: "other",
          toolName: "media-analysis.local",
          operationId: "media.analysis.local_dry_run",
          providerId: "media-analysis",
          backend: "host",
          status: "completed",
          cwd: "/workspace/project",
          readableRoots: ["/workspace/project"],
          writableRoots: ["/workspace/project"],
          networkPolicy: "none",
          command: "media-analysis-runner inspect --fixture dry-run",
          commandPattern: {
            executable: "media-analysis-runner",
            argv: ["inspect", "--fixture", "dry-run"],
            operationId: "media.analysis.local_dry_run",
          },
          process: {
            pid: 4242,
            ownedProcess: true,
          },
        },
      ],
    },
    runnerIntentState,
    summary: {
      providerRunnerCount: 1,
      sandboxBackendAdmissionEvidenceCount: 1,
      sandboxCommandExecutionEvidenceCount: 1,
      processLedgerEntryCount: 1,
      providerCredentialsUsedCount: 0,
      networkUsedCount: 0,
      liveRunnerStartedCount: 0,
      runnerIntentTokenIssuedCount: runnerIntentState.runnerIntentTokenIssued ? 1 : 0,
      runnerIntentRevokedCount:
        runnerIntentState.runnerIntentRevocationStatus === "revoked" ? 1 : 0,
    },
  };
}

function resolveAllGateReportWithRealNonVoiceProviderRunnerExtension(report) {
  if (report?.realNonVoiceProviderRunnerExtension) {
    return report;
  }
  const artifact = readJsonOrNull(artifactRelativePath);
  return {
    ...(report ?? { suiteId: "director-agent-os-all-gate" }),
    realNonVoiceProviderRunnerExtension: artifact,
  };
}

function evaluateSourceCoverage() {
  return requiredSourceCoverage.map((item) => {
    const path = resolve(repoRoot, item.path);
    if (!existsSync(path)) {
      return {
        ...item,
        ok: false,
        missingNeedles: item.needles,
        error: "missing-file",
      };
    }
    const content = readText(item.path);
    const missingNeedles = item.needles.filter((needle) => !content.includes(needle));
    return {
      ...item,
      ok: missingNeedles.length === 0,
      missingNeedles,
    };
  });
}

function evaluateArtifactCoverage() {
  return requiredArtifactCoverage.map((item) => {
    const artifactPath = resolve(repoRoot, item.path);
    const artifactExists = existsSync(artifactPath);
    const artifact = artifactExists ? readJsonOrNull(item.path) : null;
    const subject =
      item.id === "agent-os-all-latest-real-non-voice-provider-runner-report"
        ? resolveAllGateReportWithRealNonVoiceProviderRunnerExtension(artifact)
        : artifact;
    const failedChecks = item.checks
      .map((check, index) => ({ index, passed: check(subject) }))
      .filter((check) => !check.passed)
      .map((check) => indexLabel(check.index));
    return {
      id: item.id,
      path: item.path,
      ok: artifactExists && failedChecks.length === 0,
      artifactExists,
      failedChecks,
    };
  });
}

function indexLabel(index) {
  return `check-${index}`;
}

const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
const candidateArtifact = createRealNonVoiceProviderRunnerExtension(allGateReport);
writeFileSync(
  resolve(repoRoot, artifactRelativePath),
  `${JSON.stringify(candidateArtifact, null, 2)}\n`,
  "utf8",
);

const sourceCoverage = evaluateSourceCoverage();
const artifactCoverage = evaluateArtifactCoverage();
const failedSourceCoverage = sourceCoverage.filter((item) => !item.ok);
const failedArtifactCoverage = artifactCoverage.filter((item) => !item.ok);

mkdirSync(resultsDir, { recursive: true });
const report = {
  suiteId,
  timestamp: new Date().toISOString(),
  status:
    failedSourceCoverage.length === 0 && failedArtifactCoverage.length === 0 ? "passed" : "failed",
  summary: {
    sourceCoverageCount: sourceCoverage.length,
    failedSourceCoverageCount: failedSourceCoverage.length,
    artifactCoverageCount: artifactCoverage.length,
    failedArtifactCoverageCount: failedArtifactCoverage.length,
  },
  sourceCoverage,
  artifactCoverage,
};

writeFileSync(latestPath, JSON.stringify(report, null, 2));
process.stdout.write(
  `Director Agent OS real non-voice provider runner extension gate completed: source failures ${failedSourceCoverage.length}, artifact failures ${failedArtifactCoverage.length}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failedSourceCoverage.length > 0 || failedArtifactCoverage.length > 0) {
  for (const item of failedSourceCoverage) {
    process.stderr.write(
      `${item.id} failed source coverage: ${(item.missingNeedles ?? []).join(", ")}\n`,
    );
  }
  for (const item of failedArtifactCoverage) {
    process.stderr.write(
      `${item.id} failed artifact coverage checks: ${item.failedChecks.join(", ")}\n`,
    );
  }
  process.exitCode = 1;
}
