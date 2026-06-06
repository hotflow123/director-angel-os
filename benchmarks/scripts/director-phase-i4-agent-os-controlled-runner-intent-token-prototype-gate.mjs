import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const artifactRelativePath =
  "benchmarks/results/director-agent-os-controlled-runner-intent-token-prototype-latest.json";
const revocationRecordRelativePath =
  "benchmarks/results/director-agent-os-controlled-runner-intent-revocation-latest.json";
const desktopSmokeEvidenceArtifactRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-evidence-artifact-latest.json";
const desktopSmokeManualRunArtifactValidatorRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-manual-run-artifact-validator-latest.json";
const nonVoiceProviderSmokeCandidateRelativePath =
  "benchmarks/results/director-agent-os-non-voice-provider-smoke-candidate-latest.json";

const requiredSourceCoverage = [
  {
    id: "agent-os-all-controlled-runner-intent-token-prototype-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
      "function createControlledRunnerIntentTokenPrototype",
      "const controlledRunnerIntentTokenPrototype",
      "controlledRunnerIntentTokenPrototype,",
      "controlledRunnerIntentTokenPrototypePath",
      "controlledRunnerIntentRevocationRecordPath",
      '"director.agent-os.controlled-runner-intent-token-prototype.v1"',
      '"local-dry-run-token-envelope"',
      "artifactHashBundle",
      "revocationRecord",
      "ttlSeconds: 900",
      "operatorScope",
      "noUserDataGuarantee: true",
      "prototypeTokenIssued: true",
      "liveRunnerTokenIssued: false",
      "runnerIntentTokenIssued: false",
    ],
  },
  {
    id: "release-suite-controlled-runner-intent-token-prototype-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
      "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype",
      "controlled-runner-intent-token-prototype",
      "expectedControlledRunnerIntentTokenPrototypeBenchmarkScript",
      "expectedControlledRunnerIntentTokenPrototypeRootScript",
      "bench:director-agent-os-controlled-runner-intent-token-prototype",
    ],
  },
  {
    id: "manifest-controlled-runner-intent-token-prototype-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
      "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype",
      "Phase I.4 gate proving the controlled runner intent token prototype only issues a local dry-run envelope",
    ],
  },
  {
    id: "package-controlled-runner-intent-token-prototype-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-controlled-runner-intent-token-prototype"',
      "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype",
    ],
  },
  {
    id: "benchmarks-package-controlled-runner-intent-token-prototype-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-controlled-runner-intent-token-prototype"',
      "node ./scripts/director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate.mjs",
    ],
  },
  {
    id: "readme-controlled-runner-intent-token-prototype-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-controlled-runner-intent-token-prototype",
      "Phase I.4 gate proving the controlled runner intent token prototype only issues a local dry-run envelope",
    ],
  },
  {
    id: "remaining-execution-controlled-runner-intent-token-prototype-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] I.4 受控 runner intent token 签发原型",
      "必须带 TTL、revocation record、operator scope、audit artifact hash 和 no-user-data guarantee",
      "默认 fail closed，必须有 revocation，证据链不完整时不发 token",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-controlled-runner-intent-token-prototype-report",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.schemaVersion ===
        "director.agent-os.controlled-runner-intent-token-prototype.v1",
      (report) => report?.controlledRunnerIntentTokenPrototype?.status === "ready",
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.prototypeMode ===
        "local-dry-run-token-envelope",
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.preconditions?.i1ArtifactReady === true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.preconditions?.i2ValidatorReady === true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.preconditions?.i3ProviderCandidateReady ===
        true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.prototypeTokenIssued === true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.runnerIntentTokenIssued ===
        false,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.liveRunnerTokenIssued ===
        false,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.executionTokenIssued === false,
      (report) => report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.ttlSeconds === 900,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.operatorScope?.scopeId ===
        "local-operator-dry-run-release-smoke",
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.tokenEnvelope?.noUserDataGuarantee === true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.revocationRecord?.status === "ready",
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.revocationRecord?.revocationRecordRequired ===
        true,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.artifactHashBundle
          ?.desktopSmokeEvidenceArtifactSha256?.length === 64,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.artifactHashBundle
          ?.desktopSmokeManualRunArtifactValidatorSha256?.length === 64,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.artifactHashBundle
          ?.nonVoiceProviderSmokeCandidateSha256?.length === 64,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.summary?.prototypeTokenIssuedCount === 1,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.summary?.liveRunnerTokenIssuedCount === 0,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.summary?.runnerIntentTokenIssuedCount === 0,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.summary?.acceptedUnsafeMutationCount === 0,
      (report) =>
        report?.controlledRunnerIntentTokenPrototype?.summary?.rejectedUnsafeMutationCount === 8,
    ],
  },
  {
    id: "controlled-runner-intent-token-prototype-artifact-file",
    path: artifactRelativePath,
    checks: [
      (artifact) =>
        artifact?.schemaVersion === "director.agent-os.controlled-runner-intent-token-prototype.v1",
      (artifact) => artifact?.status === "ready",
      (artifact) => artifact?.prototypeMode === "local-dry-run-token-envelope",
      (artifact) => artifact?.tokenEnvelope?.prototypeTokenIssued === true,
      (artifact) => artifact?.tokenEnvelope?.liveRunnerTokenIssued === false,
      (artifact) => artifact?.tokenEnvelope?.runnerIntentTokenIssued === false,
      (artifact) => artifact?.tokenEnvelope?.ttlSeconds === 900,
      (artifact) => artifact?.tokenEnvelope?.noUserDataGuarantee === true,
      (artifact) => artifact?.revocationRecord?.status === "ready",
      (artifact) => artifact?.summary?.acceptedUnsafeMutationCount === 0,
    ],
  },
  {
    id: "controlled-runner-intent-revocation-record-file",
    path: revocationRecordRelativePath,
    checks: [
      (artifact) =>
        artifact?.schemaVersion ===
        "director.agent-os.controlled-runner-intent-revocation-record.v1",
      (artifact) => artifact?.status === "ready",
      (artifact) => artifact?.revocationRecordRequired === true,
      (artifact) => artifact?.liveRunnerBlocked === true,
      (artifact) => artifact?.prototypeTokenId === "runner-intent-prototype:local-dry-run-smoke",
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

function readTextWithHash(path) {
  try {
    const text = readText(path);
    return {
      ok: true,
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
      json: JSON.parse(text),
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      sha256: null,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createRevocationRecord({ generatedAt, prototypeTokenId, artifactHashBundle }) {
  return {
    schemaVersion: "director.agent-os.controlled-runner-intent-revocation-record.v1",
    status: "ready",
    revocationRecordRequired: true,
    revocationRecordPath: revocationRecordRelativePath,
    prototypeTokenId,
    revocable: true,
    revoked: false,
    liveRunnerBlocked: true,
    createdAt: generatedAt,
    artifactHashBundle,
  };
}

function safeIsoPlusSeconds(isoValue, seconds) {
  const time = Date.parse(isoValue);
  return new Date(time + seconds * 1000).toISOString();
}

function createArtifactHashBundle(artifacts) {
  return {
    desktopSmokeEvidenceArtifactSha256: artifacts.i1.sha256,
    desktopSmokeManualRunArtifactValidatorSha256: artifacts.i2.sha256,
    nonVoiceProviderSmokeCandidateSha256: artifacts.i3.sha256,
  };
}

function createUnsafeMutationCases(candidate) {
  return [
    {
      id: "reject-missing-ttl",
      candidate: {
        ...candidate,
        tokenEnvelope: { ...candidate.tokenEnvelope, ttlSeconds: 0 },
      },
    },
    {
      id: "reject-missing-revocation-record",
      candidate: { ...candidate, revocationRecord: null },
    },
    {
      id: "reject-missing-operator-scope",
      candidate: {
        ...candidate,
        tokenEnvelope: { ...candidate.tokenEnvelope, operatorScope: null },
      },
    },
    {
      id: "reject-missing-artifact-hash",
      candidate: { ...candidate, artifactHashBundle: {} },
    },
    {
      id: "reject-user-data-guarantee-false",
      candidate: {
        ...candidate,
        tokenEnvelope: { ...candidate.tokenEnvelope, noUserDataGuarantee: false },
      },
    },
    {
      id: "reject-i2-not-ready",
      candidate: {
        ...candidate,
        preconditions: { ...candidate.preconditions, i2ValidatorReady: false },
      },
    },
    {
      id: "reject-live-token-issued",
      candidate: {
        ...candidate,
        tokenEnvelope: { ...candidate.tokenEnvelope, liveRunnerTokenIssued: true },
      },
    },
    {
      id: "reject-real-runner-token-issued",
      candidate: {
        ...candidate,
        tokenEnvelope: { ...candidate.tokenEnvelope, runnerIntentTokenIssued: true },
      },
    },
  ];
}

function validateControlledRunnerIntentTokenPrototype(candidate) {
  const requiredArtifactHashKeys = [
    "desktopSmokeEvidenceArtifactSha256",
    "desktopSmokeManualRunArtifactValidatorSha256",
    "nonVoiceProviderSmokeCandidateSha256",
  ];
  const checks = [
    [
      "schema",
      candidate?.schemaVersion === "director.agent-os.controlled-runner-intent-token-prototype.v1",
    ],
    ["status", candidate?.status === "ready"],
    ["prototype-mode", candidate?.prototypeMode === "local-dry-run-token-envelope"],
    ["i1-ready", candidate?.preconditions?.i1ArtifactReady === true],
    ["i2-ready", candidate?.preconditions?.i2ValidatorReady === true],
    ["i3-ready", candidate?.preconditions?.i3ProviderCandidateReady === true],
    [
      "ttl",
      candidate?.tokenEnvelope?.ttlSeconds > 0 && candidate?.tokenEnvelope?.ttlSeconds <= 900,
    ],
    ["revocation-record", candidate?.revocationRecord?.status === "ready"],
    [
      "operator-scope",
      candidate?.tokenEnvelope?.operatorScope?.scopeId === "local-operator-dry-run-release-smoke",
    ],
    [
      "artifact-hashes",
      requiredArtifactHashKeys.every((key) =>
        /^[a-f0-9]{64}$/u.test(String(candidate?.artifactHashBundle?.[key])),
      ),
    ],
    ["no-user-data", candidate?.tokenEnvelope?.noUserDataGuarantee === true],
    ["prototype-issued", candidate?.tokenEnvelope?.prototypeTokenIssued === true],
    ["no-live-token", candidate?.tokenEnvelope?.liveRunnerTokenIssued === false],
    ["no-real-runner-token", candidate?.tokenEnvelope?.runnerIntentTokenIssued === false],
    ["no-execution-token", candidate?.tokenEnvelope?.executionTokenIssued === false],
    [
      "live-runner-blocked",
      candidate?.canStartLiveRunner === false && candidate?.liveRunnerStarted === false,
    ],
  ].map(([id, passed]) => ({
    id,
    status: passed ? "passed" : "failed",
  }));
  const failedChecks = checks.filter((check) => check.status !== "passed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    failedChecks: failedChecks.map((check) => check.id),
    checks,
  };
}

function createControlledRunnerIntentTokenPrototype({ generatedAt }) {
  const artifacts = {
    i1: readTextWithHash(desktopSmokeEvidenceArtifactRelativePath),
    i2: readTextWithHash(desktopSmokeManualRunArtifactValidatorRelativePath),
    i3: readTextWithHash(nonVoiceProviderSmokeCandidateRelativePath),
  };
  const preconditions = {
    i1ArtifactReady:
      artifacts.i1.ok &&
      artifacts.i1.json?.schemaVersion ===
        "director.agent-os.desktop-smoke-evidence-artifact-file.v1" &&
      artifacts.i1.json?.status === "ready" &&
      artifacts.i1.json?.noUserDataGuarantee === true,
    i2ValidatorReady:
      artifacts.i2.ok &&
      artifacts.i2.json?.schemaVersion ===
        "director.agent-os.desktop-smoke-manual-run-artifact-validator.v1" &&
      artifacts.i2.json?.status === "ready" &&
      artifacts.i2.json?.summary?.userDataReadCount === 0,
    i3ProviderCandidateReady:
      artifacts.i3.ok &&
      artifacts.i3.json?.schemaVersion ===
        "director.agent-os.non-voice-provider-smoke-candidate.v1" &&
      artifacts.i3.json?.status === "ready" &&
      artifacts.i3.json?.providerCandidate?.providerCredentialsUsed === false &&
      artifacts.i3.json?.providerCandidate?.networkUsed === false,
  };
  const artifactHashBundle = createArtifactHashBundle(artifacts);
  const prototypeTokenId = "runner-intent-prototype:local-dry-run-smoke";
  const revocationRecord = createRevocationRecord({
    generatedAt,
    prototypeTokenId,
    artifactHashBundle,
  });
  const tokenEnvelope = {
    schemaVersion: "director.agent-os.controlled-runner-intent-token-envelope.v1",
    prototypeTokenId,
    prototypeTokenIssued: true,
    runnerIntentTokenIssued: false,
    liveRunnerTokenIssued: false,
    executionTokenIssued: false,
    dryRunOnly: true,
    ttlSeconds: 900,
    issuedAt: generatedAt,
    expiresAt: safeIsoPlusSeconds(generatedAt, 900),
    operatorScope: {
      scopeId: "local-operator-dry-run-release-smoke",
      allowedCheckIds: [
        "real-desktop-device-release-smoke",
        "media-understanding.local.non-voice-provider-smoke",
      ],
      localOnly: true,
      networkAllowed: false,
      providerCredentialsAllowed: false,
    },
    artifactHashBundle,
    noUserDataGuarantee: true,
    prototypeSignature: createHash("sha256")
      .update(JSON.stringify({ prototypeTokenId, generatedAt, artifactHashBundle }))
      .digest("hex"),
    signingKeyRef: "local-dry-run-prototype-key:not-secret",
  };
  const candidate = {
    schemaVersion: "director.agent-os.controlled-runner-intent-token-prototype.v1",
    status:
      Object.values(preconditions).every(Boolean) && revocationRecord.status === "ready"
        ? "ready"
        : "blocked",
    prototypeMode: "local-dry-run-token-envelope",
    artifactPath: resolve(repoRoot, artifactRelativePath),
    artifactRelativePath,
    generatedAt,
    preconditions,
    artifactHashBundle,
    revocationRecord,
    tokenEnvelope,
    canStartLiveRunner: false,
    liveRunnerStarted: false,
  };
  const unsafeMutationResults = createUnsafeMutationCases(candidate).map((fixture) => {
    const result = validateControlledRunnerIntentTokenPrototype(fixture.candidate);
    return {
      id: fixture.id,
      status: result.status === "failed" ? "rejected" : "accepted",
      failedChecks: result.failedChecks,
    };
  });
  const acceptedUnsafeMutationResults = unsafeMutationResults.filter(
    (result) => result.status !== "rejected",
  );
  const validation = validateControlledRunnerIntentTokenPrototype(candidate);
  return {
    ...candidate,
    status:
      candidate.status === "ready" &&
      validation.status === "passed" &&
      acceptedUnsafeMutationResults.length === 0
        ? "ready"
        : "blocked",
    validation,
    unsafeMutationResults,
    summary: {
      prototypeTokenIssuedCount: tokenEnvelope.prototypeTokenIssued ? 1 : 0,
      liveRunnerTokenIssuedCount: tokenEnvelope.liveRunnerTokenIssued ? 1 : 0,
      runnerIntentTokenIssuedCount: tokenEnvelope.runnerIntentTokenIssued ? 1 : 0,
      executionTokenIssuedCount: tokenEnvelope.executionTokenIssued ? 1 : 0,
      noUserDataGuaranteeCount: tokenEnvelope.noUserDataGuarantee ? 1 : 0,
      revocationRecordReadyCount: revocationRecord.status === "ready" ? 1 : 0,
      rejectedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status === "rejected",
      ).length,
      acceptedUnsafeMutationCount: acceptedUnsafeMutationResults.length,
    },
  };
}

function resolveAllGateReportWithControlledRunnerIntentTokenPrototype(report) {
  if (report?.controlledRunnerIntentTokenPrototype) {
    return report;
  }
  const artifact = readJsonOrNull(artifactRelativePath);
  return {
    ...(report ?? { suiteId: "director-agent-os-all-gate" }),
    controlledRunnerIntentTokenPrototype: artifact,
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
      item.id === "agent-os-all-latest-controlled-runner-intent-token-prototype-report"
        ? resolveAllGateReportWithControlledRunnerIntentTokenPrototype(artifact)
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

const generatedAt = new Date().toISOString();
const controlledRunnerIntentTokenPrototype = createControlledRunnerIntentTokenPrototype({
  generatedAt,
});
writeFileSync(
  resolve(repoRoot, artifactRelativePath),
  `${JSON.stringify(controlledRunnerIntentTokenPrototype, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(repoRoot, revocationRecordRelativePath),
  `${JSON.stringify(controlledRunnerIntentTokenPrototype.revocationRecord, null, 2)}\n`,
  "utf8",
);

const sourceCoverage = evaluateSourceCoverage();
const artifactCoverage = evaluateArtifactCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedArtifactCoverage = artifactCoverage.filter((result) => result.status !== "passed");
const report = {
  suiteId,
  generatedAt,
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
  `Director Agent OS controlled runner intent token prototype gate completed: ${report.status}\n`,
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
    "Director Agent OS controlled runner intent token prototype gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
