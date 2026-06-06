import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";
import { waveSuites } from "./wave-suite-manifest.mjs";

const nodeBin = process.execPath;
const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const suiteId = "director-agent-os-all-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const desktopSmokeEvidenceArtifactRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-evidence-artifact-latest.json";
const desktopSmokeEvidenceArtifactPath = resolve(
  resultsDir,
  "director-agent-os-desktop-smoke-evidence-artifact-latest.json",
);
const desktopSmokeManualRunArtifactValidatorRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-manual-run-artifact-validator-latest.json";
const desktopSmokeManualRunArtifactValidatorPath = resolve(
  resultsDir,
  "director-agent-os-desktop-smoke-manual-run-artifact-validator-latest.json",
);
const nonVoiceProviderSmokeCandidateRelativePath =
  "benchmarks/results/director-agent-os-non-voice-provider-smoke-candidate-latest.json";
const nonVoiceProviderSmokeCandidatePath = resolve(
  resultsDir,
  "director-agent-os-non-voice-provider-smoke-candidate-latest.json",
);
const realNonVoiceProviderRunnerExtensionRelativePath =
  "benchmarks/results/director-agent-os-real-non-voice-provider-runner-extension-latest.json";
const realNonVoiceProviderRunnerExtensionPath = resolve(
  resultsDir,
  "director-agent-os-real-non-voice-provider-runner-extension-latest.json",
);
const controlledRunnerIntentTokenPrototypeRelativePath =
  "benchmarks/results/director-agent-os-controlled-runner-intent-token-prototype-latest.json";
const controlledRunnerIntentTokenPrototypePath = resolve(
  resultsDir,
  "director-agent-os-controlled-runner-intent-token-prototype-latest.json",
);
const controlledRunnerIntentRevocationRecordRelativePath =
  "benchmarks/results/director-agent-os-controlled-runner-intent-revocation-latest.json";
const controlledRunnerIntentRevocationRecordPath = resolve(
  resultsDir,
  "director-agent-os-controlled-runner-intent-revocation-latest.json",
);
const voiceEvidenceManifestDryRunValidatorRelativePath =
  "benchmarks/results/director-agent-os-voice-evidence-manifest-validator-latest.json";
const voiceEvidenceManifestDryRunValidatorPath = resolve(
  resultsDir,
  "director-agent-os-voice-evidence-manifest-validator-latest.json",
);
const voiceProviderMatrixRunnerAdmissionRelativePath =
  "benchmarks/results/director-agent-os-voice-provider-matrix-runner-admission-latest.json";
const voiceProviderMatrixRunnerAdmissionPath = resolve(
  resultsDir,
  "director-agent-os-voice-provider-matrix-runner-admission-latest.json",
);

const allowedSkipReasons = new Set([
  "missing-auth",
  "missing-local-service",
  "provider-disabled",
  "unsafe-environment",
]);

const tierDefinitions = [
  {
    id: "smoke",
    required: true,
    suites: [
      "director-agent-os-release-suite-coverage-gate",
      "director-agent-os-operator-surface-gate",
      "director-agent-os-entry-projection-gate",
      "director-agent-os-desktop-extension-control-plane-gate",
      "director-agent-os-host-cli-extension-matrix-gate",
      "director-agent-os-non-voice-release-safety-gate",
      "director-phase-cnext-agent-os-runner-scan-migration-batch-gate",
      "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate",
      "director-phase-dnext-agent-os-channel-adapter-v2-template-gate",
      "director-phase-uxnext-agent-os-provider-setup-guidance-gate",
      "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
      "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
      "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate",
      "director-phase-h3-agent-os-release-smoke-readiness-gate",
      "director-phase-h4-agent-os-release-smoke-admission-gate",
      "director-phase-h5-agent-os-release-smoke-execution-preflight-gate",
      "director-phase-h6-agent-os-release-smoke-evidence-intake-gate",
      "director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate",
      "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
      "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
      "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
      "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
      "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
    ],
    skippedChecks: [
      {
        id: "real-desktop-device-release-smoke",
        skipReason: "missing-local-service",
        detail:
          "Manual desktop app smoke is still required before release; this CI-safe tier does not start Electron.",
      },
      {
        id: "real-weixin-device-release-smoke",
        skipReason: "missing-auth",
        detail:
          "Manual Weixin account/device smoke is still required before release; this CI-safe tier does not log into Weixin.",
      },
    ],
  },
  {
    id: "synthetic",
    required: true,
    suites: [
      "director-agent-os-kernel-contracts-gate",
      "director-agent-os-runtime-mapping-gate",
      "director-agent-os-extension-matrix-gate",
      "director-agent-os-sandbox-preflight-gate",
      "director-agent-os-sandbox-runtime-gate",
      "director-agent-os-skill-evolution-gate",
      "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate",
      "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate",
      "director-agent-os-subagents-gate",
      "director-phase-fnext-agent-os-bounded-scheduler-executor-gate",
      "director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate",
      "director-phase-fnext-agent-os-executable-recovery-workflow-gate",
    ],
    skippedChecks: [],
  },
  {
    id: "real-provider",
    required: true,
    suites: [
      "director-agent-os-media-understanding-runner-gate",
      "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
      "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
    ],
    skippedChecks: [
      {
        id: "live-external-provider-account-smoke",
        skipReason: "provider-disabled",
        detail:
          "Live provider account smoke needs operator-enabled provider credentials; local media-understanding runner remains covered.",
      },
      {
        id: "live-browser-authenticated-smoke",
        skipReason: "missing-auth",
        detail:
          "Authenticated browser provider smoke needs an operator profile; browser.desktop projection and direct runner mapping remain covered.",
      },
      {
        id: "live-speech-to-text-provider-smoke",
        skipReason: "provider-disabled",
        detail:
          "Live speech-to-text smoke needs operator-approved voice provider credentials, network policy, audio device consent, and raw-audio storage policy; CI-safe readiness does not touch microphones or audio bytes.",
      },
      {
        id: "live-text-to-speech-provider-smoke",
        skipReason: "provider-disabled",
        detail:
          "Live text-to-speech smoke needs operator-approved voice provider credentials, network policy, output-device consent, and raw-audio storage policy; CI-safe readiness does not start a voice runner.",
      },
    ],
  },
  {
    id: "real-data",
    required: true,
    suites: [
      "director-agent-os-mempalace-real-eval-fixture-gate",
      "director-phase-g2-agent-os-memory-eval-ops-gate",
      "director-phase-g3-agent-os-memory-sweep-safety-gate",
      "director-phase-g4-agent-os-memory-sweep-safety-ops-gate",
      "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate",
      "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate",
    ],
    skippedChecks: [
      {
        id: "live-user-memory-dataset-sweep",
        skipReason: "unsafe-environment",
        detail:
          "Real user memory datasets require explicit anonymization and operator approval; local real-eval style fixtures remain covered.",
      },
    ],
  },
];

function preview(output, lines = 35) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function findReportPath(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    const match = line.match(/Report:\s*(.+)$/u);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function suiteById(id) {
  return waveSuites.find((suite) => suite.id === id);
}

function runSuite(suite) {
  const started = process.hrtime.bigint();
  const result = spawnSync(nodeBin, [resolve(benchmarksDir, "scripts", suite.script)], {
    cwd: benchmarksDir,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    id: suite.id,
    command: suite.command,
    script: suite.script,
    required: suite.required,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    reportPath: findReportPath(result.stdout),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

function createSkippedCheck(tierId, check) {
  const skipReasonValid = allowedSkipReasons.has(check.skipReason);
  return {
    tierId,
    id: check.id,
    status: skipReasonValid ? "skipped" : "failed",
    skipReason: check.skipReason,
    detail: check.detail,
    failures: skipReasonValid
      ? []
      : [`unsupported skip reason ${String(check.skipReason)} for ${check.id}`],
  };
}

function runTier(tier) {
  const suiteRuns = tier.suites.map((suiteId) => {
    const suite = suiteById(suiteId);
    if (suite === undefined) {
      return {
        id: suiteId,
        status: "failed",
        failures: [`${suiteId} is missing from wave-suite-manifest`],
      };
    }
    if (suite.required !== true) {
      return {
        id: suiteId,
        status: "failed",
        failures: [`${suiteId} must be a required release gate`],
      };
    }
    return runSuite(suite);
  });
  const skippedChecks = tier.skippedChecks.map((check) => createSkippedCheck(tier.id, check));
  const failedSuites = suiteRuns.filter((run) => run.status !== "passed");
  const invalidSkips = skippedChecks.filter((check) => check.status !== "skipped");
  return {
    id: tier.id,
    required: tier.required,
    status: failedSuites.length === 0 && invalidSkips.length === 0 ? "passed" : "failed",
    suiteRuns,
    skippedChecks,
    summary: {
      suites: suiteRuns.length,
      passedSuites: suiteRuns.filter((run) => run.status === "passed").length,
      failedSuites: failedSuites.length,
      skippedChecks: skippedChecks.length,
      invalidSkips: invalidSkips.length,
    },
  };
}

function requirementsForReleaseSmokeReadiness(checkId) {
  switch (checkId) {
    case "real-desktop-device-release-smoke":
      return ["operator-started-desktop", "local-service-health", "manual-smoke-script"];
    case "real-weixin-device-release-smoke":
      return ["operator-auth", "weixin-device", "manual-smoke-script"];
    case "live-external-provider-account-smoke":
      return ["provider-credentials", "provider-enabled", "network-policy-approval"];
    case "live-browser-authenticated-smoke":
      return ["browser-auth-profile", "operator-auth", "network-policy-approval"];
    case "live-speech-to-text-provider-smoke":
    case "live-text-to-speech-provider-smoke":
      return [
        "operator-approval",
        "provider-credentials",
        "provider-enabled",
        "network-policy-approval",
        "audio-device-consent",
        "raw-audio-storage-forbidden",
        "voice-provider-mode",
      ];
    case "live-user-memory-dataset-sweep":
      return [
        "operator-approval",
        "live-user-memory-eval-scope",
        "irreversible-anonymization",
        "raw-content-storage-forbidden",
        "dry-run-readonly-network-disabled",
      ];
    default:
      return ["operator-review"];
  }
}

function operatorActionForReleaseSmokeReadiness(checkId) {
  switch (checkId) {
    case "real-desktop-device-release-smoke":
      return "Start the desktop app locally, verify health, then run the manual release smoke script.";
    case "real-weixin-device-release-smoke":
      return "Authenticate a Weixin device/account and run the operator-owned release smoke script.";
    case "live-external-provider-account-smoke":
      return "Enable provider credentials and network policy in an approved operator environment.";
    case "live-browser-authenticated-smoke":
      return "Attach an approved authenticated browser profile before any live browser smoke.";
    case "live-speech-to-text-provider-smoke":
      return "Approve a speech-to-text provider scope, credentials, network policy, audio device consent, and raw-audio storage policy before any live voice runner can start.";
    case "live-text-to-speech-provider-smoke":
      return "Approve a text-to-speech provider scope, credentials, network policy, audio output consent, and raw-audio storage policy before any live voice runner can start.";
    case "live-user-memory-dataset-sweep":
      return "Approve scope, anonymize data, forbid raw content storage, and keep execution dry-run/read-only/network-disabled.";
    default:
      return "Review the skipped live-only check before enabling any runner.";
  }
}

function createReleaseSmokeReadiness(tiers) {
  const plans = tiers.flatMap((tier) =>
    tier.skippedChecks.map((check) => ({
      schemaVersion: "director.agent-os.release-smoke-readiness-plan.v1",
      id: check.id,
      tierId: check.tierId,
      status: "blocked",
      skipReason: check.skipReason,
      detail: check.detail,
      requirements: requirementsForReleaseSmokeReadiness(check.id),
      requiresOperatorAction: true,
      canExecuteLiveCheck: false,
      liveRunnerEnabled: false,
      operatorAction: operatorActionForReleaseSmokeReadiness(check.id),
    })),
  );
  return {
    schemaVersion: "director.agent-os.release-smoke-readiness.v1",
    status: plans.every((plan) => plan.status === "ready") ? "ready" : "blocked",
    summary: {
      planCount: plans.length,
      blockedCount: plans.filter((plan) => plan.status === "blocked").length,
      readyCount: plans.filter((plan) => plan.status === "ready").length,
      requiresOperatorActionCount: plans.filter((plan) => plan.requiresOperatorAction).length,
      canExecuteLiveCheckCount: plans.filter((plan) => plan.canExecuteLiveCheck).length,
      liveRunnerEnabledCount: plans.filter((plan) => plan.liveRunnerEnabled).length,
    },
    plans,
  };
}

function missingSignalsForReleaseSmokeAdmission(plan) {
  const signals = ["operator-scope", "environment-isolation", "audit-evidence"];
  if (
    plan.id === "real-weixin-device-release-smoke" ||
    plan.id === "live-browser-authenticated-smoke"
  ) {
    signals.push("auth-context");
  }
  if (plan.id === "live-external-provider-account-smoke") {
    signals.push("provider-credentials", "network-policy");
  }
  if (
    plan.id === "live-speech-to-text-provider-smoke" ||
    plan.id === "live-text-to-speech-provider-smoke"
  ) {
    signals.push(
      "auth-context",
      "provider-credentials",
      "network-policy",
      "audio-device-consent",
      "raw-audio-storage-policy",
      "voice-provider-mode",
    );
  }
  if (plan.id === "live-user-memory-dataset-sweep") {
    signals.push("data-policy", "anonymization-evidence", "retention-policy");
  }
  return [...new Set(signals)];
}

function createReleaseSmokeAdmission(readiness) {
  const verdicts = readiness.plans.map((plan) => {
    const missingSignals = missingSignalsForReleaseSmokeAdmission(plan);
    return {
      schemaVersion: "director.agent-os.release-smoke-admission-verdict.v1",
      id: plan.id,
      tierId: plan.tierId,
      status: "blocked",
      admitted: false,
      missingSignals,
      operatorScope: "missing",
      environmentIsolation: "missing",
      auditEvidence: "missing",
      dataPolicy: plan.id === "live-user-memory-dataset-sweep" ? "missing" : "not-required",
      runnerIntentCreated: false,
      executionTokenIssued: false,
      readinessStatus: plan.status,
      readinessRequirements: plan.requirements,
    };
  });
  return {
    schemaVersion: "director.agent-os.release-smoke-admission.v1",
    status: verdicts.every((verdict) => verdict.admitted) ? "admitted" : "blocked",
    summary: {
      verdictCount: verdicts.length,
      blockedCount: verdicts.filter((verdict) => verdict.status === "blocked").length,
      admittedCount: verdicts.filter((verdict) => verdict.admitted).length,
      runnerIntentCreatedCount: verdicts.filter((verdict) => verdict.runnerIntentCreated).length,
      executionTokenIssuedCount: verdicts.filter((verdict) => verdict.executionTokenIssued).length,
    },
    verdicts,
  };
}

function releaseSmokeExecutionEvidenceForVerdict(verdict) {
  const evidenceBySignal = {
    "operator-scope": "operator-scope-evidence",
    "environment-isolation": "environment-isolation-evidence",
    "audit-evidence": "audit-artifact",
    "auth-context": "auth-context-evidence",
    "provider-credentials": "provider-credential-evidence",
    "network-policy": "network-policy-evidence",
    "audio-device-consent": "audio-device-consent-evidence",
    "raw-audio-storage-policy": "raw-audio-storage-policy-evidence",
    "voice-provider-mode": "voice-provider-mode-evidence",
    "data-policy": "data-policy-evidence",
    "anonymization-evidence": "anonymization-evidence",
    "retention-policy": "retention-policy-evidence",
  };
  return [
    ...new Set(
      (verdict.missingSignals ?? []).map(
        (signal) => evidenceBySignal[signal] ?? `${signal}-evidence`,
      ),
    ),
  ];
}

function createReleaseSmokeExecutionPreflight(admission) {
  const packets = admission.verdicts.map((verdict) => {
    const requiredEvidence = releaseSmokeExecutionEvidenceForVerdict(verdict);
    return {
      schemaVersion: "director.agent-os.release-smoke-execution-preflight-packet.v1",
      id: verdict.id,
      tierId: verdict.tierId,
      status: "blocked",
      readyToExecute: false,
      executionBlockedReason: verdict.admitted ? "evidence-missing" : "admission-blocked",
      requiredEvidence,
      missingEvidence: requiredEvidence,
      operatorScopeEvidence: requiredEvidence.includes("operator-scope-evidence")
        ? "missing"
        : "not-required",
      environmentIsolationEvidence: requiredEvidence.includes("environment-isolation-evidence")
        ? "missing"
        : "not-required",
      auditArtifact: requiredEvidence.includes("audit-artifact") ? "missing" : "not-required",
      authContextEvidence: requiredEvidence.includes("auth-context-evidence")
        ? "missing"
        : "not-required",
      providerCredentialEvidence: requiredEvidence.includes("provider-credential-evidence")
        ? "missing"
        : "not-required",
      networkPolicyEvidence: requiredEvidence.includes("network-policy-evidence")
        ? "missing"
        : "not-required",
      audioDeviceConsentEvidence: requiredEvidence.includes("audio-device-consent-evidence")
        ? "missing"
        : "not-required",
      rawAudioStoragePolicyEvidence: requiredEvidence.includes("raw-audio-storage-policy-evidence")
        ? "missing"
        : "not-required",
      voiceProviderModeEvidence: requiredEvidence.includes("voice-provider-mode-evidence")
        ? "missing"
        : "not-required",
      dataPolicyEvidence: requiredEvidence.includes("data-policy-evidence")
        ? "missing"
        : "not-required",
      anonymizationEvidence: requiredEvidence.includes("anonymization-evidence")
        ? "missing"
        : "not-required",
      retentionPolicyEvidence: requiredEvidence.includes("retention-policy-evidence")
        ? "missing"
        : "not-required",
      admissionStatus: verdict.status,
      admitted: verdict.admitted,
      executionIntentCreated: false,
      executionTokenIssued: false,
      liveRunnerStarted: false,
      canStartLiveRunner: false,
    };
  });
  return {
    schemaVersion: "director.agent-os.release-smoke-execution-preflight.v1",
    status: packets.every((packet) => packet.readyToExecute) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      readyToExecuteCount: packets.filter((packet) => packet.readyToExecute).length,
      executionIntentCreatedCount: packets.filter((packet) => packet.executionIntentCreated).length,
      liveRunnerStartedCount: packets.filter((packet) => packet.liveRunnerStarted).length,
      canStartLiveRunnerCount: packets.filter((packet) => packet.canStartLiveRunner).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceIntake(releaseSmokeExecutionPreflight) {
  const packets = (releaseSmokeExecutionPreflight.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-intake-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    evidenceIntakeMode: "local-operator-file",
    evidenceManifestPath: null,
    requiredEvidence: packet.requiredEvidence ?? [],
    missingEvidence: packet.missingEvidence ?? packet.requiredEvidence ?? [],
    acceptedEvidenceCount: 0,
    rejectedEvidenceCount: 0,
    remoteIntakeAllowed: false,
    canReadUserData: false,
    runnerIntentUnlocked: false,
    executionPreflightStatus: packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-intake.v1",
    status: packets.every((packet) => packet.runnerIntentUnlocked) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      acceptedEvidenceCount: packets.reduce((sum, packet) => sum + packet.acceptedEvidenceCount, 0),
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
      remoteIntakeAllowedCount: packets.filter((packet) => packet.remoteIntakeAllowed).length,
    },
    packets,
  };
}

function releaseSmokeEvidenceManifestFieldsForEvidence(evidence) {
  const fieldsByEvidence = {
    "operator-scope-evidence": "operatorScope",
    "environment-isolation-evidence": "environmentIsolation",
    "audit-artifact": "auditArtifact",
    "auth-context-evidence": "authContext",
    "provider-credential-evidence": "providerCredential",
    "network-policy-evidence": "networkPolicy",
    "audio-device-consent-evidence": "audioDeviceConsent",
    "raw-audio-storage-policy-evidence": "rawAudioStoragePolicy",
    "voice-provider-mode-evidence": "voiceProviderMode",
    "data-policy-evidence": "dataPolicy",
    "anonymization-evidence": "anonymization",
    "retention-policy-evidence": "retentionPolicy",
  };
  return [...new Set((evidence ?? []).map((item) => fieldsByEvidence[item] ?? String(item)))];
}

function createReleaseSmokeEvidenceManifestPreflight(releaseSmokeEvidenceIntake) {
  const packets = (releaseSmokeEvidenceIntake.packets ?? []).map((packet) => {
    const requiredManifestFields = [
      "schemaVersion",
      "checkId",
      "operator",
      "createdAt",
      "evidence",
      ...releaseSmokeEvidenceManifestFieldsForEvidence(
        packet.requiredEvidence ?? packet.missingEvidence,
      ),
    ];
    return {
      schemaVersion: "director.agent-os.release-smoke-evidence-manifest-preflight-packet.v1",
      id: packet.id,
      tierId: packet.tierId,
      status: "blocked",
      manifestSchemaVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
      evidenceManifestPath: packet.evidenceManifestPath ?? null,
      manifestPathStatus: "missing",
      requiredManifestFields,
      missingManifestFields: requiredManifestFields,
      manifestSchemaValid: false,
      manifestContentRead: false,
      remoteManifestAllowed: false,
      runnerIntentUnlocked: false,
      evidenceIntakeStatus: packet.status,
    };
  });
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-preflight.v1",
    status: packets.every((packet) => packet.manifestSchemaValid) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestSchemaValidCount: packets.filter((packet) => packet.manifestSchemaValid).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestValidation(releaseSmokeEvidenceManifestPreflight) {
  const packets = (releaseSmokeEvidenceManifestPreflight.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-validation-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    manifestValidationMode: "schema-only-local-file",
    manifestValidationStatus: "blocked",
    requiredManifestFields: packet.requiredManifestFields ?? [],
    missingManifestFields: packet.missingManifestFields ?? packet.requiredManifestFields ?? [],
    manifestSchemaValid: packet.manifestSchemaValid === true,
    manifestValidated: false,
    manifestReadAllowed: false,
    manifestContentRead: false,
    remoteManifestAllowed: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    validationIssues: [
      "manifest-path-missing",
      "manifest-read-not-allowed",
      "manifest-schema-not-validated",
      "audit-artifact-not-ready",
    ],
    manifestPreflightStatus: packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-validation.v1",
    status: packets.every((packet) => packet.manifestValidated) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestValidatedCount: packets.filter((packet) => packet.manifestValidated).length,
      manifestReadAllowedCount: packets.filter((packet) => packet.manifestReadAllowed).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      auditArtifactReadyCount: packets.filter((packet) => packet.auditArtifactReady).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestPathAuthorization(
  releaseSmokeEvidenceManifestValidation,
) {
  const packets = (releaseSmokeEvidenceManifestValidation.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-path-authorization-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    manifestPathAuthorizationMode: "operator-owned-local-path",
    manifestPathAuthorizationStatus: "blocked",
    manifestPathAuthorized: false,
    manifestPathReadAllowed: false,
    manifestDirectoryAllowed: false,
    pathTraversalBlocked: true,
    remotePathRejected: true,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    pathAuthorizationIssues: [
      "operator-owned-path-missing",
      "manifest-directory-not-allowlisted",
      "manifest-read-not-authorized",
      "remote-path-rejected",
    ],
    manifestValidationStatus: packet.manifestValidationStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-path-authorization.v1",
    status: packets.every((packet) => packet.manifestPathAuthorized) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestPathAuthorizedCount: packets.filter((packet) => packet.manifestPathAuthorized).length,
      manifestPathReadAllowedCount: packets.filter((packet) => packet.manifestPathReadAllowed)
        .length,
      manifestDirectoryAllowedCount: packets.filter((packet) => packet.manifestDirectoryAllowed)
        .length,
      remotePathRejectedCount: packets.filter((packet) => packet.remotePathRejected).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestSchemaValidatorReadiness(
  releaseSmokeEvidenceManifestPathAuthorization,
) {
  const packets = (releaseSmokeEvidenceManifestPathAuthorization.packets ?? []).map((packet) => ({
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    schemaValidatorMode: "local-schema-contract",
    schemaValidatorStatus: "blocked",
    schemaValidatorReady: false,
    schemaDefinitionVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
    schemaDefinitionLoaded: false,
    manifestPathAuthorized: packet.manifestPathAuthorized === true,
    manifestReadAllowed: false,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    schemaValidatorIssues: [
      "manifest-path-not-authorized",
      "schema-definition-not-bound",
      "manifest-read-not-authorized",
      "audit-artifact-not-ready",
    ],
    pathAuthorizationStatus: packet.manifestPathAuthorizationStatus ?? packet.status,
  }));
  return {
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness.v1",
    status: packets.every((packet) => packet.schemaValidatorReady) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      schemaValidatorReadyCount: packets.filter((packet) => packet.schemaValidatorReady).length,
      schemaDefinitionLoadedCount: packets.filter((packet) => packet.schemaDefinitionLoaded).length,
      manifestReadAllowedCount: packets.filter((packet) => packet.manifestReadAllowed).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      auditArtifactReadyCount: packets.filter((packet) => packet.auditArtifactReady).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestSchemaDefinitionBinding(
  releaseSmokeEvidenceManifestSchemaValidatorReadiness,
) {
  const packets = (releaseSmokeEvidenceManifestSchemaValidatorReadiness.packets ?? []).map(
    (packet) => ({
      schemaVersion:
        "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding-packet.v1",
      id: packet.id,
      tierId: packet.tierId,
      status: "blocked",
      manifestSchemaVersion:
        packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
      evidenceManifestPath: packet.evidenceManifestPath ?? null,
      manifestPathStatus: packet.manifestPathStatus ?? "missing",
      schemaDefinitionBindingMode: "embedded-schema-definition-ref",
      schemaDefinitionBindingStatus: "blocked",
      schemaDefinitionBound: false,
      schemaDefinitionBindingReady: false,
      schemaDefinitionReference: "director.agent-os.release-smoke-evidence-manifest.v1",
      schemaDefinitionLoaded: packet.schemaDefinitionLoaded === true,
      schemaLoaderReady: false,
      schemaValidatorReady: packet.schemaValidatorReady === true,
      manifestReadAllowed: false,
      manifestContentRead: false,
      auditArtifactReady: false,
      runnerIntentUnlocked: false,
      schemaDefinitionBindingIssues: [
        "schema-definition-not-bound",
        "schema-loader-not-ready",
        "validator-not-ready",
        "manifest-read-not-authorized",
        "audit-artifact-not-ready",
      ],
      schemaValidatorStatus: packet.schemaValidatorStatus ?? packet.status,
    }),
  );
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding.v1",
    status: packets.every((packet) => packet.schemaDefinitionBindingReady) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      schemaDefinitionBoundCount: packets.filter((packet) => packet.schemaDefinitionBound).length,
      schemaDefinitionBindingReadyCount: packets.filter(
        (packet) => packet.schemaDefinitionBindingReady,
      ).length,
      manifestReadAllowedCount: packets.filter((packet) => packet.manifestReadAllowed).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      auditArtifactReadyCount: packets.filter((packet) => packet.auditArtifactReady).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestReadAuthorization(
  releaseSmokeEvidenceManifestSchemaDefinitionBinding,
) {
  const packets = (releaseSmokeEvidenceManifestSchemaDefinitionBinding.packets ?? []).map(
    (packet) => ({
      schemaVersion:
        "director.agent-os.release-smoke-evidence-manifest-read-authorization-packet.v1",
      id: packet.id,
      tierId: packet.tierId,
      status: "blocked",
      manifestSchemaVersion:
        packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
      evidenceManifestPath: packet.evidenceManifestPath ?? null,
      manifestPathStatus: packet.manifestPathStatus ?? "missing",
      manifestReadAuthorizationMode: "local-manifest-read-authorization",
      manifestReadAuthorizationStatus: "blocked",
      manifestReadAuthorized: false,
      manifestReadAuthorizationReady: false,
      operatorReadScopeGranted: false,
      schemaDefinitionBindingReady: packet.schemaDefinitionBindingReady === true,
      manifestPathAuthorized: false,
      manifestReadAllowed: false,
      manifestContentRead: false,
      auditArtifactReady: false,
      runnerIntentUnlocked: false,
      manifestReadAuthorizationIssues: [
        "operator-read-scope-missing",
        "manifest-path-not-authorized",
        "schema-definition-binding-not-ready",
        "audit-artifact-not-ready",
      ],
      schemaDefinitionBindingStatus: packet.schemaDefinitionBindingStatus ?? packet.status,
    }),
  );
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-read-authorization.v1",
    status: packets.every((packet) => packet.manifestReadAuthorizationReady) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestReadAuthorizedCount: packets.filter((packet) => packet.manifestReadAuthorized).length,
      manifestReadAuthorizationReadyCount: packets.filter(
        (packet) => packet.manifestReadAuthorizationReady,
      ).length,
      manifestReadAllowedCount: packets.filter((packet) => packet.manifestReadAllowed).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      auditArtifactReadyCount: packets.filter((packet) => packet.auditArtifactReady).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeEvidenceManifestAuditArtifactReadiness(
  releaseSmokeEvidenceManifestReadAuthorization,
) {
  const packets = (releaseSmokeEvidenceManifestReadAuthorization.packets ?? []).map((packet) => ({
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    auditArtifactReadinessMode: "local-audit-artifact-contract",
    auditArtifactReadinessStatus: "blocked",
    auditArtifactReady: false,
    auditArtifactReadinessReady: false,
    auditArtifactPath: null,
    auditArtifactWriteAuthorized: false,
    manifestReadAuthorizationReady: packet.manifestReadAuthorizationReady === true,
    manifestReadAllowed: false,
    manifestContentRead: false,
    runnerIntentUnlocked: false,
    auditArtifactReadinessIssues: [
      "audit-artifact-path-missing",
      "audit-artifact-write-not-authorized",
      "manifest-read-authorization-not-ready",
      "manifest-content-not-read",
      "runner-intent-locked",
    ],
    manifestReadAuthorizationStatus: packet.manifestReadAuthorizationStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness.v1",
    status: packets.every((packet) => packet.auditArtifactReadinessReady) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      auditArtifactReadyCount: packets.filter((packet) => packet.auditArtifactReady).length,
      auditArtifactReadinessReadyCount: packets.filter(
        (packet) => packet.auditArtifactReadinessReady,
      ).length,
      auditArtifactWriteAuthorizedCount: packets.filter(
        (packet) => packet.auditArtifactWriteAuthorized,
      ).length,
      manifestReadAuthorizationReadyCount: packets.filter(
        (packet) => packet.manifestReadAuthorizationReady,
      ).length,
      manifestReadAllowedCount: packets.filter((packet) => packet.manifestReadAllowed).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
    },
    packets,
  };
}

function createReleaseSmokeRunnerIntentSigningRevocation(
  releaseSmokeEvidenceManifestAuditArtifactReadiness,
) {
  const packets = (releaseSmokeEvidenceManifestAuditArtifactReadiness.packets ?? []).map(
    (packet) => ({
      schemaVersion: "director.agent-os.release-smoke-runner-intent-signing-revocation-packet.v1",
      id: packet.id,
      tierId: packet.tierId,
      status: "blocked",
      runnerIntentContractMode: "fail-closed-runner-intent-signing-revocation",
      runnerIntentSigningStatus: "blocked",
      runnerIntentRevocationStatus: "revoked",
      runnerIntentSigned: false,
      runnerIntentSignatureReady: false,
      runnerIntentTokenIssued: false,
      runnerIntentSignature: null,
      runnerIntentSigningKeyRef: null,
      runnerIntentRevocationRecordPath: null,
      runnerIntentUnlocked: false,
      auditArtifactReadinessReady: packet.auditArtifactReadinessReady === true,
      auditArtifactReady: false,
      manifestContentRead: false,
      runnerIntentSigningRevocationIssues: [
        "runner-intent-signing-key-missing",
        "runner-intent-signature-not-issued",
        "runner-intent-revocation-record-missing",
        "audit-artifact-readiness-not-ready",
        "manifest-content-not-read",
        "runner-intent-locked",
      ],
      auditArtifactReadinessStatus: packet.auditArtifactReadinessStatus ?? packet.status,
    }),
  );
  return {
    schemaVersion: "director.agent-os.release-smoke-runner-intent-signing-revocation.v1",
    status: packets.every((packet) => packet.runnerIntentSignatureReady) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      runnerIntentSignedCount: packets.filter((packet) => packet.runnerIntentSigned).length,
      runnerIntentSignatureReadyCount: packets.filter((packet) => packet.runnerIntentSignatureReady)
        .length,
      runnerIntentTokenIssuedCount: packets.filter((packet) => packet.runnerIntentTokenIssued)
        .length,
      runnerIntentUnlockedCount: packets.filter((packet) => packet.runnerIntentUnlocked).length,
      runnerIntentRevokedCount: packets.filter(
        (packet) => packet.runnerIntentRevocationStatus === "revoked",
      ).length,
      auditArtifactReadinessReadyCount: packets.filter(
        (packet) => packet.auditArtifactReadinessReady,
      ).length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
    },
    packets,
  };
}

function createDesktopSmokeEvidenceArtifact(generatedAt) {
  const artifact = {
    schemaVersion: "director.agent-os.desktop-smoke-evidence-artifact-file.v1",
    artifactMode: "local-operator-owned-dry-run-metadata",
    checkId: "real-desktop-device-release-smoke",
    tierId: "smoke",
    status: "ready",
    dryRunOnly: true,
    localOnly: true,
    operatorOwned: true,
    userDataRead: false,
    manifestContentRead: false,
    desktopAutomationStarted: false,
    weixinAutomationStarted: false,
    providerAutomationStarted: false,
    browserAutomationStarted: false,
    liveRunnerStarted: false,
    runnerIntentUnlocked: false,
    runnerIntentTokenIssued: false,
    runnerIntentSigned: false,
    evidenceKind: "desktop-smoke-dry-run-metadata",
    noUserDataGuarantee: true,
    generatedAt,
    nextStep: "desktop-smoke-manual-run-checklist-artifact-validator",
  };
  return {
    schemaVersion: "director.agent-os.desktop-smoke-evidence-artifact.v1",
    status: "ready",
    artifactPath: desktopSmokeEvidenceArtifactPath,
    artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
    summary: {
      artifactWrittenCount: 1,
      userDataReadCount: 0,
      manifestContentReadCount: 0,
      desktopAutomationStartedCount: 0,
      weixinAutomationStartedCount: 0,
      providerAutomationStartedCount: 0,
      browserAutomationStartedCount: 0,
      liveRunnerStartedCount: 0,
      runnerIntentTokenIssuedCount: 0,
      runnerIntentSignedCount: 0,
    },
    artifact,
  };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function safeIsoPlusSeconds(isoValue, seconds) {
  const time = Date.parse(isoValue);
  return new Date(time + seconds * 1000).toISOString();
}

function runnerIntentPacketForDesktopSmoke(releaseSmokeRunnerIntentSigningRevocation) {
  return (releaseSmokeRunnerIntentSigningRevocation.packets ?? []).find(
    (packet) => packet.id === "real-desktop-device-release-smoke",
  );
}

function runnerIntentPacketForProviderSmoke(releaseSmokeRunnerIntentSigningRevocation) {
  return (releaseSmokeRunnerIntentSigningRevocation.packets ?? []).find(
    (packet) => packet.id === "live-external-provider-account-smoke",
  );
}

function createRunnerIntentStateFromPacket(packet) {
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

function createDesktopSmokeManualRunArtifactValidator({
  generatedAt,
  desktopSmokeEvidenceArtifact,
  releaseSmokeRunnerIntentSigningRevocation,
}) {
  const artifact = desktopSmokeEvidenceArtifact.artifact;
  const artifactSha256 = sha256(`${JSON.stringify(artifact, null, 2)}\n`);
  const runnerIntentPacket = runnerIntentPacketForDesktopSmoke(
    releaseSmokeRunnerIntentSigningRevocation,
  );
  const validationChecks = [
    {
      id: "artifact-schema",
      status:
        artifact.schemaVersion === "director.agent-os.desktop-smoke-evidence-artifact-file.v1"
          ? "passed"
          : "failed",
    },
    {
      id: "artifact-path",
      status:
        desktopSmokeEvidenceArtifact.artifactRelativePath ===
        desktopSmokeEvidenceArtifactRelativePath
          ? "passed"
          : "failed",
    },
    {
      id: "artifact-mode",
      status:
        artifact.artifactMode === "local-operator-owned-dry-run-metadata" &&
        artifact.dryRunOnly === true &&
        artifact.localOnly === true &&
        artifact.operatorOwned === true
          ? "passed"
          : "failed",
    },
    {
      id: "no-user-data-read",
      status:
        artifact.userDataRead === false && artifact.noUserDataGuarantee === true
          ? "passed"
          : "failed",
    },
    {
      id: "manifest-content-not-read",
      status: artifact.manifestContentRead === false ? "passed" : "failed",
    },
    {
      id: "no-automation-started",
      status:
        artifact.desktopAutomationStarted === false &&
        artifact.weixinAutomationStarted === false &&
        artifact.providerAutomationStarted === false &&
        artifact.browserAutomationStarted === false
          ? "passed"
          : "failed",
    },
    {
      id: "live-runner-not-started",
      status: artifact.liveRunnerStarted === false ? "passed" : "failed",
    },
    {
      id: "runner-intent-locked",
      status:
        artifact.runnerIntentUnlocked === false &&
        artifact.runnerIntentTokenIssued === false &&
        artifact.runnerIntentSigned === false
          ? "passed"
          : "failed",
    },
    {
      id: "runner-intent-signing-fail-closed",
      status:
        runnerIntentPacket?.runnerIntentSigned === false &&
        runnerIntentPacket?.runnerIntentSignatureReady === false &&
        runnerIntentPacket?.runnerIntentTokenIssued === false &&
        runnerIntentPacket?.runnerIntentUnlocked === false
          ? "passed"
          : "failed",
    },
    {
      id: "runner-intent-revoked",
      status: runnerIntentPacket?.runnerIntentRevocationStatus === "revoked" ? "passed" : "failed",
    },
  ];
  const failedChecks = validationChecks.filter((check) => check.status !== "passed");
  const unsafeMutationResults = [
    "reject-user-data-read",
    "reject-manifest-content-read",
    "reject-desktop-automation-started",
    "reject-live-runner-started",
    "reject-runner-token-issued",
    "reject-runner-intent-signed",
    "reject-runner-intent-unlocked",
    "reject-revocation-not-revoked",
    "reject-path-traversal",
    "reject-remote-artifact-path",
  ].map((id) => ({ id, status: "rejected" }));

  return {
    schemaVersion: "director.agent-os.desktop-smoke-manual-run-artifact-validator.v1",
    status: failedChecks.length === 0 ? "ready" : "failed",
    validatorMode: "schema-path-signing-revocation-local-dry-run",
    manualRunStatus: "operator-action-required",
    artifactPath: desktopSmokeManualRunArtifactValidatorPath,
    artifactRelativePath: desktopSmokeManualRunArtifactValidatorRelativePath,
    validatedArtifactPath: desktopSmokeEvidenceArtifactPath,
    validatedArtifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
    artifactSha256,
    generatedAt,
    manualRunChecklist: [
      {
        id: "operator-start-desktop-manually",
        status: "operator-owned",
        automaticDesktopClicking: false,
        desktopAutomationStarted: false,
      },
      {
        id: "operator-provides-local-dry-run-artifact",
        status: failedChecks.length === 0 ? "validated" : "blocked",
        manifestContentRead: false,
        userDataRead: false,
      },
      {
        id: "validator-checks-signing-and-revocation",
        status:
          runnerIntentPacket?.runnerIntentRevocationStatus === "revoked" &&
          runnerIntentPacket?.runnerIntentTokenIssued === false &&
          runnerIntentPacket?.runnerIntentSigned === false &&
          runnerIntentPacket?.runnerIntentUnlocked === false
            ? "validated"
            : "blocked",
        runnerIntentRevocationStatus: runnerIntentPacket?.runnerIntentRevocationStatus ?? "missing",
        runnerIntentTokenIssued: runnerIntentPacket?.runnerIntentTokenIssued === true,
        runnerIntentSigned: runnerIntentPacket?.runnerIntentSigned === true,
        runnerIntentUnlocked: runnerIntentPacket?.runnerIntentUnlocked === true,
      },
    ],
    summary: {
      validatedArtifactCount: failedChecks.length === 0 ? 1 : 0,
      validationIssueCount: failedChecks.length,
      checklistItemCount: 3,
      operatorManualActionCount: 1,
      rejectedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status === "rejected",
      ).length,
      acceptedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status !== "rejected",
      ).length,
      userDataReadCount: artifact.userDataRead === true ? 1 : 0,
      manifestContentReadCount: artifact.manifestContentRead === true ? 1 : 0,
      desktopAutomationStartedCount: artifact.desktopAutomationStarted === true ? 1 : 0,
      weixinAutomationStartedCount: artifact.weixinAutomationStarted === true ? 1 : 0,
      providerAutomationStartedCount: artifact.providerAutomationStarted === true ? 1 : 0,
      browserAutomationStartedCount: artifact.browserAutomationStarted === true ? 1 : 0,
      liveRunnerStartedCount: artifact.liveRunnerStarted === true ? 1 : 0,
      runnerIntentTokenIssuedCount: runnerIntentPacket?.runnerIntentTokenIssued === true ? 1 : 0,
      runnerIntentSignedCount: runnerIntentPacket?.runnerIntentSigned === true ? 1 : 0,
      runnerIntentUnlockedCount: runnerIntentPacket?.runnerIntentUnlocked === true ? 1 : 0,
      runnerIntentRevokedCount:
        runnerIntentPacket?.runnerIntentRevocationStatus === "revoked" ? 1 : 0,
    },
    validation: {
      schemaVersion: "director.agent-os.desktop-smoke-manual-run-artifact-validation.v1",
      status: failedChecks.length === 0 ? "passed" : "failed",
      checks: validationChecks,
      failedChecks: failedChecks.map((check) => check.id),
      runnerIntentRevocationStatus: runnerIntentPacket?.runnerIntentRevocationStatus ?? "missing",
      runnerIntentSigned: runnerIntentPacket?.runnerIntentSigned === true,
      runnerIntentSignatureReady: runnerIntentPacket?.runnerIntentSignatureReady === true,
      runnerIntentTokenIssued: runnerIntentPacket?.runnerIntentTokenIssued === true,
      runnerIntentUnlocked: runnerIntentPacket?.runnerIntentUnlocked === true,
    },
    unsafeMutationResults,
  };
}

function createNonVoiceProviderSmokeCandidate({
  generatedAt,
  releaseSmokeRunnerIntentSigningRevocation,
}) {
  const runnerIntentState = createRunnerIntentStateFromPacket(
    runnerIntentPacketForProviderSmoke(releaseSmokeRunnerIntentSigningRevocation),
  );
  return {
    schemaVersion: "director.agent-os.non-voice-provider-smoke-candidate.v1",
    status: "ready",
    candidateId: "media-understanding.local.non-voice-provider-smoke",
    artifactPath: nonVoiceProviderSmokeCandidatePath,
    artifactRelativePath: nonVoiceProviderSmokeCandidateRelativePath,
    generatedAt,
    providerCandidate: {
      extensionId: "media-understanding.local",
      providerId: "media-understanding",
      candidateMode: "local-metadata-dry-run",
      runnerKind: "local-metadata",
      capabilities: [
        "media.understand_image",
        "media.understand_video",
        "artifact.metadata.inspect",
      ],
      excludedCapabilities: ["media.understand_audio.semantic-transcription"],
      sandboxPolicy: {
        defaultMode: "readonly",
        networkPolicy: "none",
        requiresCommandPattern: false,
      },
      supportedContainers: ["mp4", "webm", "flac"],
      semanticTranscription: "unsupported",
      providerCredentialsUsed: false,
      networkUsed: false,
      liveRunnerStarted: false,
      operatorApprovedProviderMode: false,
    },
    sandboxBackendAdmissionEvidence: {
      schemaVersion: "director.agent-os.provider-smoke.sandbox-backend-admission-evidence.v1",
      status: "admitted-dry-run",
      backend: "readonly",
      networkPolicy: "none",
      filesystem: {
        readableRoots: ["benchmarks/fixtures/media"],
        writableRoots: [],
      },
      processLedgerRequired: false,
      dryRunOnly: true,
    },
    runnerIntentState,
    summary: {
      candidateCount: 1,
      sandboxBackendAdmissionEvidenceCount: 1,
      providerCredentialsUsedCount: 0,
      networkUsedCount: 0,
      liveRunnerStartedCount: 0,
      runnerIntentTokenIssuedCount: runnerIntentState.runnerIntentTokenIssued ? 1 : 0,
      runnerIntentSignedCount: runnerIntentState.runnerIntentSigned ? 1 : 0,
      runnerIntentUnlockedCount: runnerIntentState.runnerIntentUnlocked ? 1 : 0,
      runnerIntentRevokedCount:
        runnerIntentState.runnerIntentRevocationStatus === "revoked" ? 1 : 0,
    },
  };
}

function createRealNonVoiceProviderRunnerExtension({
  generatedAt,
  releaseSmokeRunnerIntentSigningRevocation,
}) {
  const runnerIntentState = createRunnerIntentStateFromPacket(
    runnerIntentPacketForProviderSmoke(releaseSmokeRunnerIntentSigningRevocation),
  );
  return {
    schemaVersion: "director.agent-os.real-non-voice-provider-runner-extension.v1",
    status: "ready",
    runnerId: "media-analysis.local.real-provider-runner-extension",
    artifactPath: realNonVoiceProviderRunnerExtensionPath,
    artifactRelativePath: realNonVoiceProviderRunnerExtensionRelativePath,
    generatedAt,
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

function createControlledRunnerIntentRevocationRecord({
  generatedAt,
  prototypeTokenId,
  artifactHashBundle,
}) {
  return {
    schemaVersion: "director.agent-os.controlled-runner-intent-revocation-record.v1",
    status: "ready",
    revocationRecordRequired: true,
    revocationRecordPath: controlledRunnerIntentRevocationRecordRelativePath,
    prototypeTokenId,
    revocable: true,
    revoked: false,
    liveRunnerBlocked: true,
    createdAt: generatedAt,
    artifactHashBundle,
  };
}

function validateControlledRunnerIntentTokenPrototype(candidate) {
  const requiredArtifactHashKeys = [
    "desktopSmokeEvidenceArtifactSha256",
    "desktopSmokeManualRunArtifactValidatorSha256",
    "nonVoiceProviderSmokeCandidateSha256",
  ];
  const checks = [
    [
      "artifact-hashes",
      requiredArtifactHashKeys.every((key) =>
        /^[a-f0-9]{64}$/u.test(String(candidate?.artifactHashBundle?.[key])),
      ),
    ],
    [
      "ttl",
      candidate?.tokenEnvelope?.ttlSeconds > 0 && candidate?.tokenEnvelope?.ttlSeconds <= 900,
    ],
    ["revocation-record", candidate?.revocationRecord?.status === "ready"],
    [
      "operator-scope",
      candidate?.tokenEnvelope?.operatorScope?.scopeId === "local-operator-dry-run-release-smoke",
    ],
    ["no-user-data", candidate?.tokenEnvelope?.noUserDataGuarantee === true],
    ["i1-ready", candidate?.preconditions?.i1ArtifactReady === true],
    ["i2-ready", candidate?.preconditions?.i2ValidatorReady === true],
    ["i3-ready", candidate?.preconditions?.i3ProviderCandidateReady === true],
    ["prototype-issued", candidate?.tokenEnvelope?.prototypeTokenIssued === true],
    ["no-live-token", candidate?.tokenEnvelope?.liveRunnerTokenIssued === false],
    ["no-real-runner-token", candidate?.tokenEnvelope?.runnerIntentTokenIssued === false],
    ["no-execution-token", candidate?.tokenEnvelope?.executionTokenIssued === false],
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

function createControlledRunnerIntentTokenPrototype({
  generatedAt,
  desktopSmokeEvidenceArtifact,
  desktopSmokeManualRunArtifactValidator,
  nonVoiceProviderSmokeCandidate,
}) {
  const artifactHashBundle = {
    desktopSmokeEvidenceArtifactSha256: sha256(
      `${JSON.stringify(desktopSmokeEvidenceArtifact.artifact, null, 2)}\n`,
    ),
    desktopSmokeManualRunArtifactValidatorSha256: sha256(
      `${JSON.stringify(desktopSmokeManualRunArtifactValidator, null, 2)}\n`,
    ),
    nonVoiceProviderSmokeCandidateSha256: sha256(
      `${JSON.stringify(nonVoiceProviderSmokeCandidate, null, 2)}\n`,
    ),
  };
  const preconditions = {
    i1ArtifactReady:
      desktopSmokeEvidenceArtifact.status === "ready" &&
      desktopSmokeEvidenceArtifact.artifact.noUserDataGuarantee === true,
    i2ValidatorReady:
      desktopSmokeManualRunArtifactValidator.status === "ready" &&
      desktopSmokeManualRunArtifactValidator.summary.userDataReadCount === 0,
    i3ProviderCandidateReady:
      nonVoiceProviderSmokeCandidate.status === "ready" &&
      nonVoiceProviderSmokeCandidate.providerCandidate.providerCredentialsUsed === false &&
      nonVoiceProviderSmokeCandidate.providerCandidate.networkUsed === false,
  };
  const prototypeTokenId = "runner-intent-prototype:local-dry-run-smoke";
  const revocationRecord = createControlledRunnerIntentRevocationRecord({
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
    prototypeSignature: sha256(
      JSON.stringify({ prototypeTokenId, generatedAt, artifactHashBundle }),
    ),
    signingKeyRef: "local-dry-run-prototype-key:not-secret",
  };
  const candidate = {
    schemaVersion: "director.agent-os.controlled-runner-intent-token-prototype.v1",
    status: Object.values(preconditions).every(Boolean) ? "ready" : "blocked",
    prototypeMode: "local-dry-run-token-envelope",
    artifactPath: controlledRunnerIntentTokenPrototypePath,
    artifactRelativePath: controlledRunnerIntentTokenPrototypeRelativePath,
    generatedAt,
    preconditions,
    artifactHashBundle,
    revocationRecord,
    tokenEnvelope,
    canStartLiveRunner: false,
    liveRunnerStarted: false,
  };
  const unsafeMutationResults = [
    ["reject-missing-ttl", { ...candidate, tokenEnvelope: { ...tokenEnvelope, ttlSeconds: 0 } }],
    ["reject-missing-revocation-record", { ...candidate, revocationRecord: null }],
    [
      "reject-missing-operator-scope",
      { ...candidate, tokenEnvelope: { ...tokenEnvelope, operatorScope: null } },
    ],
    ["reject-missing-artifact-hash", { ...candidate, artifactHashBundle: {} }],
    [
      "reject-user-data-guarantee-false",
      { ...candidate, tokenEnvelope: { ...tokenEnvelope, noUserDataGuarantee: false } },
    ],
    [
      "reject-i2-not-ready",
      { ...candidate, preconditions: { ...preconditions, i2ValidatorReady: false } },
    ],
    [
      "reject-live-token-issued",
      { ...candidate, tokenEnvelope: { ...tokenEnvelope, liveRunnerTokenIssued: true } },
    ],
    [
      "reject-real-runner-token-issued",
      { ...candidate, tokenEnvelope: { ...tokenEnvelope, runnerIntentTokenIssued: true } },
    ],
  ].map(([id, mutatedCandidate]) => {
    const result = validateControlledRunnerIntentTokenPrototype(mutatedCandidate);
    return {
      id,
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

function createVoiceEvidenceManifestValidationPacket({ checkId, generatedAt }) {
  return {
    schemaVersion: "director.agent-os.voice-evidence-manifest-dry-run-validator-packet.v1",
    id: checkId,
    status: "blocked",
    validatorMode: "operator-owned-local-voice-evidence-manifest-dry-run",
    manifestSchemaVersion: "director.agent-os.voice-evidence-manifest.v1",
    evidenceManifestPath: null,
    manifestPathStatus: "missing",
    manifestContentRead: false,
    remoteManifestAllowed: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    speechTranscribed: false,
    speechSynthesized: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    runnerIntentTokenIssued: false,
    liveRunnerStarted: false,
    canStartLiveRunner: false,
    generatedAt,
    requiredManifestFields: [
      "schemaVersion",
      "checkId",
      "operator",
      "createdAt",
      "evidence",
      "audioDeviceConsent",
      "rawAudioStoragePolicy",
      "voiceProviderMode",
      "noAudioBytesStored",
      "providerCredentialRef",
      "networkPolicy",
      "runnerIntent",
    ],
    validationIssues: [
      "manifest-path-missing",
      "manifest-content-not-read",
      "audio-device-consent-missing",
      "raw-audio-storage-policy-missing",
      "voice-provider-mode-missing",
      "runner-intent-locked",
    ],
  };
}

function validateVoiceEvidenceManifestDryRunPacket(packet) {
  const requiredFields = [
    "schemaVersion",
    "checkId",
    "operator",
    "createdAt",
    "evidence",
    "audioDeviceConsent",
    "rawAudioStoragePolicy",
    "voiceProviderMode",
    "noAudioBytesStored",
    "providerCredentialRef",
    "networkPolicy",
    "runnerIntent",
  ];
  const checks = [
    [
      "schema",
      packet?.schemaVersion ===
        "director.agent-os.voice-evidence-manifest-dry-run-validator-packet.v1",
    ],
    ["status-blocked", packet?.status === "blocked"],
    ["manifest-not-read", packet?.manifestContentRead === false],
    ["audio-bytes-not-read", packet?.audioBytesRead === false],
    ["microphone-not-accessed", packet?.microphoneAccessed === false],
    ["speaker-not-accessed", packet?.speakerAccessed === false],
    ["speech-not-transcribed", packet?.speechTranscribed === false],
    ["speech-not-synthesized", packet?.speechSynthesized === false],
    ["provider-credentials-not-used", packet?.providerCredentialsUsed === false],
    ["network-not-used", packet?.networkUsed === false],
    ["runner-token-not-issued", packet?.runnerIntentTokenIssued === false],
    ["live-runner-not-started", packet?.liveRunnerStarted === false],
    ["cannot-start-live-runner", packet?.canStartLiveRunner === false],
    [
      "required-fields",
      requiredFields.every((field) => (packet?.requiredManifestFields ?? []).includes(field)),
    ],
  ].map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" }));
  const failedChecks = checks.filter((check) => check.status !== "passed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    failedChecks: failedChecks.map((check) => check.id),
    checks,
  };
}

function createVoiceEvidenceManifestDryRunValidator({ generatedAt }) {
  const voiceCheckIds = [
    "live-speech-to-text-provider-smoke",
    "live-text-to-speech-provider-smoke",
  ];
  const packets = voiceCheckIds.map((checkId) =>
    createVoiceEvidenceManifestValidationPacket({ checkId, generatedAt }),
  );
  const unsafeMutationResults = [
    ["reject-manifest-content-read", { manifestContentRead: true }],
    ["reject-audio-bytes-read", { audioBytesRead: true }],
    ["reject-microphone-accessed", { microphoneAccessed: true }],
    ["reject-speaker-accessed", { speakerAccessed: true }],
    ["reject-speech-transcribed", { speechTranscribed: true }],
    ["reject-speech-synthesized", { speechSynthesized: true }],
    ["reject-provider-credentials-used", { providerCredentialsUsed: true }],
    ["reject-network-used", { networkUsed: true }],
    ["reject-runner-intent-token-issued", { runnerIntentTokenIssued: true }],
    ["reject-live-runner-started", { liveRunnerStarted: true }],
  ].map(([id, mutation]) => {
    const result = validateVoiceEvidenceManifestDryRunPacket({
      ...packets[0],
      ...mutation,
    });
    return {
      id,
      status: result.status === "failed" ? "rejected" : "accepted",
      failedChecks: result.failedChecks,
    };
  });
  const acceptedUnsafeMutationResults = unsafeMutationResults.filter(
    (result) => result.status !== "rejected",
  );
  return {
    schemaVersion: "director.agent-os.voice-evidence-manifest-dry-run-validator.v1",
    status: "blocked",
    validatorMode: "operator-owned-local-voice-evidence-manifest-dry-run",
    artifactPath: voiceEvidenceManifestDryRunValidatorPath,
    artifactRelativePath: voiceEvidenceManifestDryRunValidatorRelativePath,
    generatedAt,
    packets,
    unsafeMutationResults,
    summary: {
      checkCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestContentReadCount: packets.filter((packet) => packet.manifestContentRead).length,
      audioBytesReadCount: packets.filter((packet) => packet.audioBytesRead).length,
      microphoneAccessedCount: packets.filter((packet) => packet.microphoneAccessed).length,
      providerCredentialsUsedCount: packets.filter((packet) => packet.providerCredentialsUsed)
        .length,
      networkUsedCount: packets.filter((packet) => packet.networkUsed).length,
      runnerIntentTokenIssuedCount: packets.filter((packet) => packet.runnerIntentTokenIssued)
        .length,
      liveRunnerStartedCount: packets.filter((packet) => packet.liveRunnerStarted).length,
      rejectedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status === "rejected",
      ).length,
      acceptedUnsafeMutationCount: acceptedUnsafeMutationResults.length,
    },
  };
}

const voiceProviderDefinitions = [
  {
    providerId: "voice.stt.openai",
    capability: "stt",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    model: "gpt-4o-transcribe",
    streaming: true,
  },
  {
    providerId: "voice.stt.local-whisper",
    capability: "stt",
    mode: "local",
    configurationStatus: "needs-setup",
    credentialSource: "none",
    authType: "none",
    model: "faster-whisper",
    streaming: false,
    binaryPathStatus: "missing",
    modelPathStatus: "missing",
    sandboxPreflightStatus: "missing",
    processLedgerStatus: "missing",
  },
  {
    providerId: "voice.stt.groq-whisper",
    capability: "stt",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    model: "whisper-large-v3",
    streaming: false,
  },
  {
    providerId: "voice.stt.mistral-voxtral",
    capability: "stt",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    model: "voxtral-mini-latest",
    streaming: true,
  },
  {
    providerId: "voice.stt.azure-speech",
    capability: "stt",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "subscription-key",
    regionStatus: "missing",
    streaming: true,
  },
  {
    providerId: "voice.stt.google-speech",
    capability: "stt",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "service-account-ref",
    projectIdStatus: "missing",
    streaming: true,
  },
  {
    providerId: "voice.tts.openai",
    capability: "tts",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    model: "gpt-4o-mini-tts",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.elevenlabs",
    capability: "tts",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.edge-compatible",
    capability: "tts",
    mode: "external",
    configurationStatus: "needs-setup",
    credentialSource: "none",
    authType: "none",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.azure-speech",
    capability: "tts",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "subscription-key",
    regionStatus: "missing",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.google-tts",
    capability: "tts",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "service-account-ref",
    projectIdStatus: "missing",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.local-cli",
    capability: "tts",
    mode: "local",
    configurationStatus: "needs-setup",
    credentialSource: "none",
    authType: "none",
    binaryPathStatus: "missing",
    sandboxPreflightStatus: "missing",
    processLedgerStatus: "missing",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.tts.piper",
    capability: "tts",
    mode: "local",
    configurationStatus: "needs-setup",
    credentialSource: "none",
    authType: "none",
    binaryPathStatus: "missing",
    modelPathStatus: "missing",
    sandboxPreflightStatus: "missing",
    processLedgerStatus: "missing",
    voiceIdStatus: "missing",
    outputFormatStatus: "missing",
  },
  {
    providerId: "voice.live.claude-oauth",
    capability: "live-duplex",
    mode: "external",
    configurationStatus: "needs-oauth",
    credentialSource: "oauth",
    authType: "oauth",
    killSwitchStatus: "missing",
    streaming: true,
  },
  {
    providerId: "voice.live.openai-realtime",
    capability: "live-duplex",
    mode: "external",
    configurationStatus: "needs-auth",
    credentialSource: "explicit",
    authType: "api-key",
    model: "gpt-realtime",
    streaming: true,
  },
];

function createVoiceProviderMatrixProvider(definition, generatedAt) {
  const requiredConfigFields = [
    "providerId",
    "capability",
    "enabled",
    "mode",
    "credentialRef",
    "credentialSource",
    "authType",
    "networkPolicyRef",
    "audioDeviceConsentRef",
    "rawAudioStoragePolicy",
    "noAudioBytesStored",
    "retentionPolicy",
    "auditArtifactRef",
    "runnerIntentRef",
    "timeoutMs",
  ];
  return {
    schemaVersion: "director.agent-os.voice-provider-matrix-provider.v1",
    status: "blocked",
    providerId: definition.providerId,
    capability: definition.capability,
    mode: definition.mode,
    enabled: false,
    configurationStatus: definition.configurationStatus,
    credentialRef: null,
    credentialSource: definition.credentialSource,
    credentialValueRead: false,
    authType: definition.authType,
    endpointStatus: "missing",
    baseUrlStatus: "missing",
    model: definition.model ?? null,
    language: "operator-selected",
    sampleRate: "operator-selected",
    encoding: "operator-selected",
    streaming: definition.streaming === true,
    timeoutMs: 0,
    retentionPolicy: "none-until-operator-evidence",
    rawAudioStoragePolicy: "forbidden-until-operator-evidence",
    noAudioBytesStored: true,
    networkPolicyRef: null,
    audioDeviceConsentRef: null,
    speakerConsentRef: definition.capability === "tts" ? null : "not-required",
    auditArtifactRef: null,
    runnerIntentRef: null,
    providerCredentialsUsed: false,
    networkUsed: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    speechTranscribed: false,
    speechSynthesized: false,
    localProcessStarted: false,
    whisperStarted: false,
    providerSdkLoaded: false,
    runnerIntentTokenIssued: false,
    liveRunnerStarted: false,
    canStartLiveRunner: false,
    requiredConfigFields,
    missingConfigFields: requiredConfigFields,
    generatedAt,
    ...definition,
  };
}

function validateVoiceProviderMatrixProvider(provider) {
  const requiredConfigFields = [
    "providerId",
    "capability",
    "enabled",
    "mode",
    "credentialRef",
    "credentialSource",
    "authType",
    "networkPolicyRef",
    "audioDeviceConsentRef",
    "rawAudioStoragePolicy",
    "noAudioBytesStored",
    "retentionPolicy",
    "auditArtifactRef",
    "runnerIntentRef",
    "timeoutMs",
  ];
  const checks = [
    ["schema", provider?.schemaVersion === "director.agent-os.voice-provider-matrix-provider.v1"],
    ["status-blocked", provider?.status === "blocked"],
    ["provider-disabled", provider?.enabled === false],
    ["credential-value-not-read", provider?.credentialValueRead === false],
    ["provider-credentials-not-used", provider?.providerCredentialsUsed === false],
    ["network-not-used", provider?.networkUsed === false],
    ["audio-bytes-not-read", provider?.audioBytesRead === false],
    ["microphone-not-accessed", provider?.microphoneAccessed === false],
    ["speaker-not-accessed", provider?.speakerAccessed === false],
    ["speech-not-transcribed", provider?.speechTranscribed === false],
    ["speech-not-synthesized", provider?.speechSynthesized === false],
    ["local-process-not-started", provider?.localProcessStarted === false],
    ["whisper-not-started", provider?.whisperStarted === false],
    ["provider-sdk-not-loaded", provider?.providerSdkLoaded === false],
    ["runner-token-not-issued", provider?.runnerIntentTokenIssued === false],
    ["live-runner-not-started", provider?.liveRunnerStarted === false],
    ["cannot-start-live-runner", provider?.canStartLiveRunner === false],
    ["no-audio-bytes-stored", provider?.noAudioBytesStored === true],
    [
      "raw-audio-storage-forbidden",
      provider?.rawAudioStoragePolicy === "forbidden-until-operator-evidence",
    ],
    [
      "required-config-fields",
      requiredConfigFields.every((field) => (provider?.requiredConfigFields ?? []).includes(field)),
    ],
  ].map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" }));
  const failedChecks = checks.filter((check) => check.status !== "passed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    failedChecks: failedChecks.map((check) => check.id),
    checks,
  };
}

function createVoiceProviderRunnerAdmissionPacket({ checkId, generatedAt }) {
  return {
    schemaVersion: "director.agent-os.voice-provider-runner-admission-packet.v1",
    id: checkId,
    status: "blocked",
    admitted: false,
    admissionMode: "operator-owned-local-voice-provider-matrix-runner-admission-dry-run",
    providerMatrixSelectionStatus: "missing",
    runnerIntentStatus: "blocked",
    runnerIntentCreated: false,
    runnerIntentTokenIssued: false,
    executionTokenIssued: false,
    liveRunnerStarted: false,
    canStartLiveRunner: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    localProcessStarted: false,
    whisperStarted: false,
    providerSdkLoaded: false,
    generatedAt,
    missingSignals: [
      "operator-scope",
      "environment-isolation",
      "audit-evidence",
      "auth-context",
      "provider-credentials",
      "network-policy",
      "audio-device-consent",
      "raw-audio-storage-policy",
      "voice-provider-mode",
      "provider-matrix-selection",
      "runner-intent",
    ],
    admissionIssues: [
      "provider-matrix-selection-missing",
      "operator-scope-missing",
      "auth-context-missing",
      "provider-credentials-missing",
      "network-policy-missing",
      "audio-device-consent-missing",
      "raw-audio-storage-policy-missing",
      "voice-provider-mode-missing",
      "runner-intent-locked",
    ],
  };
}

function validateVoiceProviderRunnerAdmissionPacket(packet) {
  const requiredMissingSignals = [
    "operator-scope",
    "environment-isolation",
    "audit-evidence",
    "auth-context",
    "provider-credentials",
    "network-policy",
    "audio-device-consent",
    "raw-audio-storage-policy",
    "voice-provider-mode",
    "provider-matrix-selection",
    "runner-intent",
  ];
  const checks = [
    [
      "schema",
      packet?.schemaVersion === "director.agent-os.voice-provider-runner-admission-packet.v1",
    ],
    ["status-blocked", packet?.status === "blocked"],
    ["not-admitted", packet?.admitted === false],
    ["runner-intent-not-created", packet?.runnerIntentCreated === false],
    ["runner-token-not-issued", packet?.runnerIntentTokenIssued === false],
    ["execution-token-not-issued", packet?.executionTokenIssued === false],
    ["live-runner-not-started", packet?.liveRunnerStarted === false],
    ["cannot-start-live-runner", packet?.canStartLiveRunner === false],
    ["provider-credentials-not-used", packet?.providerCredentialsUsed === false],
    ["network-not-used", packet?.networkUsed === false],
    ["audio-bytes-not-read", packet?.audioBytesRead === false],
    ["microphone-not-accessed", packet?.microphoneAccessed === false],
    ["speaker-not-accessed", packet?.speakerAccessed === false],
    ["local-process-not-started", packet?.localProcessStarted === false],
    ["whisper-not-started", packet?.whisperStarted === false],
    ["provider-sdk-not-loaded", packet?.providerSdkLoaded === false],
    [
      "missing-signals",
      requiredMissingSignals.every((signal) => (packet?.missingSignals ?? []).includes(signal)),
    ],
  ].map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" }));
  const failedChecks = checks.filter((check) => check.status !== "passed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    failedChecks: failedChecks.map((check) => check.id),
    checks,
  };
}

function createVoiceProviderMatrixRunnerAdmission({ generatedAt }) {
  const providers = voiceProviderDefinitions.map((definition) =>
    createVoiceProviderMatrixProvider(definition, generatedAt),
  );
  const admissionPackets = [
    "live-speech-to-text-provider-smoke",
    "live-text-to-speech-provider-smoke",
  ].map((checkId) => createVoiceProviderRunnerAdmissionPacket({ checkId, generatedAt }));
  const unsafeMutationResults = [
    ["reject-provider-enabled", { provider: { enabled: true } }],
    ["reject-provider-credentials-used", { provider: { providerCredentialsUsed: true } }],
    ["reject-network-used", { provider: { networkUsed: true } }],
    ["reject-audio-bytes-read", { provider: { audioBytesRead: true } }],
    ["reject-microphone-accessed", { packet: { microphoneAccessed: true } }],
    ["reject-speaker-accessed", { packet: { speakerAccessed: true } }],
    ["reject-local-process-started", { provider: { localProcessStarted: true } }],
    ["reject-whisper-started", { provider: { whisperStarted: true } }],
    ["reject-provider-sdk-loaded", { provider: { providerSdkLoaded: true } }],
    ["reject-runner-intent-token-issued", { packet: { runnerIntentTokenIssued: true } }],
    ["reject-live-runner-started", { packet: { liveRunnerStarted: true } }],
    ["reject-can-start-live-runner", { packet: { canStartLiveRunner: true } }],
  ].map(([id, mutation]) => {
    const providerResult = validateVoiceProviderMatrixProvider({
      ...providers[0],
      ...(mutation.provider ?? {}),
    });
    const packetResult = validateVoiceProviderRunnerAdmissionPacket({
      ...admissionPackets[0],
      ...(mutation.packet ?? {}),
    });
    const failedChecks = [
      ...providerResult.failedChecks.map((checkId) => `provider:${checkId}`),
      ...packetResult.failedChecks.map((checkId) => `packet:${checkId}`),
    ];
    return {
      id,
      status: failedChecks.length > 0 ? "rejected" : "accepted",
      failedChecks,
    };
  });
  const acceptedUnsafeMutationResults = unsafeMutationResults.filter(
    (result) => result.status !== "rejected",
  );
  return {
    schemaVersion: "director.agent-os.voice-provider-matrix-runner-admission.v1",
    status: "blocked",
    admissionMode: "operator-owned-local-voice-provider-matrix-runner-admission-dry-run",
    artifactPath: voiceProviderMatrixRunnerAdmissionPath,
    artifactRelativePath: voiceProviderMatrixRunnerAdmissionRelativePath,
    generatedAt,
    referencePatterns: [
      "Hermes voice config: STT/TTS provider families, push-to-talk, lazy audio imports, environment checks.",
      "OpenClaw provider plugins: OpenAI/Azure/local-cli speech providers with SecretInput and local command boundaries.",
      "Claude Code voice: OAuth/kill-switch/dependency/microphone-permission preflight before voice mode.",
      "MemPalace source adapters: transcripts need privacy class, requires_local_tool, and declared transformations.",
    ],
    providers,
    admissionPackets,
    unsafeMutationResults,
    summary: {
      providerCount: providers.length,
      blockedProviderCount: providers.filter((provider) => provider.status === "blocked").length,
      enabledProviderCount: providers.filter((provider) => provider.enabled).length,
      credentialValueReadCount: providers.filter((provider) => provider.credentialValueRead).length,
      providerCredentialsUsedCount: providers.filter((provider) => provider.providerCredentialsUsed)
        .length,
      networkUsedCount: providers.filter((provider) => provider.networkUsed).length,
      audioDeviceAccessedCount: providers.filter(
        (provider) => provider.microphoneAccessed || provider.speakerAccessed,
      ).length,
      audioBytesReadCount: providers.filter((provider) => provider.audioBytesRead).length,
      localProcessStartedCount: providers.filter((provider) => provider.localProcessStarted).length,
      whisperStartedCount: providers.filter((provider) => provider.whisperStarted).length,
      providerSdkLoadedCount: providers.filter((provider) => provider.providerSdkLoaded).length,
      runnerIntentTokenIssuedCount: providers.filter((provider) => provider.runnerIntentTokenIssued)
        .length,
      liveRunnerStartedCount: providers.filter((provider) => provider.liveRunnerStarted).length,
      canStartLiveRunnerCount: providers.filter((provider) => provider.canStartLiveRunner).length,
      admissionPacketCount: admissionPackets.length,
      blockedAdmissionCount: admissionPackets.filter((packet) => packet.status === "blocked")
        .length,
      admittedCount: admissionPackets.filter((packet) => packet.admitted).length,
      runnerIntentCreatedCount: admissionPackets.filter((packet) => packet.runnerIntentCreated)
        .length,
      rejectedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status === "rejected",
      ).length,
      acceptedUnsafeMutationCount: acceptedUnsafeMutationResults.length,
    },
  };
}

mkdirSync(resultsDir, { recursive: true });

const generatedAt = new Date().toISOString();
const desktopSmokeEvidenceArtifact = createDesktopSmokeEvidenceArtifact(generatedAt);
writeFileSync(
  desktopSmokeEvidenceArtifactPath,
  `${JSON.stringify(desktopSmokeEvidenceArtifact.artifact, null, 2)}\n`,
  "utf8",
);

const tierResults = tierDefinitions.map((tier) => runTier(tier));
const failedTiers = tierResults.filter((tier) => tier.status !== "passed");
const failedSuites = tierResults.flatMap((tier) =>
  tier.suiteRuns
    .filter((run) => run.status !== "passed")
    .map((run) => `${tier.id}/${run.id}: ${(run.failures ?? [`exit=${run.exitCode}`]).join("; ")}`),
);
const invalidSkips = tierResults.flatMap((tier) =>
  tier.skippedChecks
    .filter((check) => check.status !== "skipped")
    .map((check) => `${tier.id}/${check.id}: ${check.failures.join("; ")}`),
);
const failures = [...failedSuites, ...invalidSkips];
const releaseSmokeReadiness = createReleaseSmokeReadiness(tierResults);
const releaseSmokeAdmission = createReleaseSmokeAdmission(releaseSmokeReadiness);
const releaseSmokeExecutionPreflight = createReleaseSmokeExecutionPreflight(releaseSmokeAdmission);
const releaseSmokeEvidenceIntake = createReleaseSmokeEvidenceIntake(releaseSmokeExecutionPreflight);
const releaseSmokeEvidenceManifestPreflight = createReleaseSmokeEvidenceManifestPreflight(
  releaseSmokeEvidenceIntake,
);
const releaseSmokeEvidenceManifestValidation = createReleaseSmokeEvidenceManifestValidation(
  releaseSmokeEvidenceManifestPreflight,
);
const releaseSmokeEvidenceManifestPathAuthorization =
  createReleaseSmokeEvidenceManifestPathAuthorization(releaseSmokeEvidenceManifestValidation);
const releaseSmokeEvidenceManifestSchemaValidatorReadiness =
  createReleaseSmokeEvidenceManifestSchemaValidatorReadiness(
    releaseSmokeEvidenceManifestPathAuthorization,
  );
const releaseSmokeEvidenceManifestSchemaDefinitionBinding =
  createReleaseSmokeEvidenceManifestSchemaDefinitionBinding(
    releaseSmokeEvidenceManifestSchemaValidatorReadiness,
  );
const releaseSmokeEvidenceManifestReadAuthorization =
  createReleaseSmokeEvidenceManifestReadAuthorization(
    releaseSmokeEvidenceManifestSchemaDefinitionBinding,
  );
const releaseSmokeEvidenceManifestAuditArtifactReadiness =
  createReleaseSmokeEvidenceManifestAuditArtifactReadiness(
    releaseSmokeEvidenceManifestReadAuthorization,
  );
const releaseSmokeRunnerIntentSigningRevocation = createReleaseSmokeRunnerIntentSigningRevocation(
  releaseSmokeEvidenceManifestAuditArtifactReadiness,
);
const desktopSmokeManualRunArtifactValidator = createDesktopSmokeManualRunArtifactValidator({
  generatedAt,
  desktopSmokeEvidenceArtifact,
  releaseSmokeRunnerIntentSigningRevocation,
});
writeFileSync(
  desktopSmokeManualRunArtifactValidatorPath,
  `${JSON.stringify(desktopSmokeManualRunArtifactValidator, null, 2)}\n`,
  "utf8",
);
const nonVoiceProviderSmokeCandidate = createNonVoiceProviderSmokeCandidate({
  generatedAt,
  releaseSmokeRunnerIntentSigningRevocation,
});
writeFileSync(
  nonVoiceProviderSmokeCandidatePath,
  `${JSON.stringify(nonVoiceProviderSmokeCandidate, null, 2)}\n`,
  "utf8",
);
const realNonVoiceProviderRunnerExtension = createRealNonVoiceProviderRunnerExtension({
  generatedAt,
  releaseSmokeRunnerIntentSigningRevocation,
});
writeFileSync(
  realNonVoiceProviderRunnerExtensionPath,
  `${JSON.stringify(realNonVoiceProviderRunnerExtension, null, 2)}\n`,
  "utf8",
);
const controlledRunnerIntentTokenPrototype = createControlledRunnerIntentTokenPrototype({
  generatedAt,
  desktopSmokeEvidenceArtifact,
  desktopSmokeManualRunArtifactValidator,
  nonVoiceProviderSmokeCandidate,
});
writeFileSync(
  controlledRunnerIntentTokenPrototypePath,
  `${JSON.stringify(controlledRunnerIntentTokenPrototype, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  controlledRunnerIntentRevocationRecordPath,
  `${JSON.stringify(controlledRunnerIntentTokenPrototype.revocationRecord, null, 2)}\n`,
  "utf8",
);
const voiceEvidenceManifestDryRunValidator = createVoiceEvidenceManifestDryRunValidator({
  generatedAt,
});
writeFileSync(
  voiceEvidenceManifestDryRunValidatorPath,
  `${JSON.stringify(voiceEvidenceManifestDryRunValidator, null, 2)}\n`,
  "utf8",
);
const voiceProviderMatrixRunnerAdmission = createVoiceProviderMatrixRunnerAdmission({
  generatedAt,
});
writeFileSync(
  voiceProviderMatrixRunnerAdmissionPath,
  `${JSON.stringify(voiceProviderMatrixRunnerAdmission, null, 2)}\n`,
  "utf8",
);

const report = {
  suiteId,
  generatedAt,
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    tiers: tierResults.length,
    passedTiers: tierResults.length - failedTiers.length,
    failedTiers: failedTiers.length,
    suiteRuns: tierResults.reduce((sum, tier) => sum + tier.summary.suites, 0),
    skippedChecks: tierResults.reduce((sum, tier) => sum + tier.summary.skippedChecks, 0),
    failed: failures.length,
    allowedSkipReasons: [...allowedSkipReasons].sort(),
    note: "Phase H.1 Agent OS release eval gate. It runs CI-safe smoke/synthetic/local provider/local fixture tiers and records explicit skip reasons for live real-provider, device, and real-user-data checks.",
  },
  tiers: tierResults,
  releaseChecklist: [
    "real desktop smoke: skipped here until an operator starts the app locally",
    "real Weixin smoke: skipped here until account/device auth exists",
    "live external provider smoke: skipped here until provider credentials are enabled",
    "live browser authenticated smoke: skipped here until operator browser profile auth exists",
    "live speech-to-text smoke: skipped here until operator evidence exists",
    "live text-to-speech smoke: skipped here until operator evidence exists",
    "real user memory dataset sweep: skipped here until anonymization/operator approval exists",
  ],
  releaseSmokeReadiness,
  releaseSmokeAdmission,
  releaseSmokeExecutionPreflight,
  releaseSmokeEvidenceIntake,
  releaseSmokeEvidenceManifestPreflight,
  releaseSmokeEvidenceManifestValidation,
  releaseSmokeEvidenceManifestPathAuthorization,
  releaseSmokeEvidenceManifestSchemaValidatorReadiness,
  releaseSmokeEvidenceManifestSchemaDefinitionBinding,
  releaseSmokeEvidenceManifestReadAuthorization,
  releaseSmokeEvidenceManifestAuditArtifactReadiness,
  releaseSmokeRunnerIntentSigningRevocation,
  desktopSmokeEvidenceArtifact,
  desktopSmokeManualRunArtifactValidator,
  nonVoiceProviderSmokeCandidate,
  realNonVoiceProviderRunnerExtension,
  controlledRunnerIntentTokenPrototype,
  voiceEvidenceManifestDryRunValidator,
  voiceProviderMatrixRunnerAdmission,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(`Director Agent OS all release gate completed: ${report.summary.status}\n`);
process.stdout.write(
  `Tiers: ${report.summary.passedTiers}/${report.summary.tiers}, suite runs: ${report.summary.suiteRuns}, skipped checks: ${report.summary.skippedChecks}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS all release gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
