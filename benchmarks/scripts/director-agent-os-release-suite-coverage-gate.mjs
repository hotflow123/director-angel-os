import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";
import { waveSuites } from "./wave-suite-manifest.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-agent-os-release-suite-coverage-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredAgentOsSuites = [
  {
    id: "director-agent-os-kernel-contracts-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-kernel",
    tier: "synthetic",
    coverage: ["kernel", "policy", "sandbox", "memory", "subagent"],
  },
  {
    id: "director-agent-os-runtime-mapping-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-runtime-mapping",
    tier: "synthetic",
    coverage: ["desktop", "weixin", "host-api", "timeline"],
  },
  {
    id: "director-agent-os-operator-surface-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-operator-surface",
    tier: "smoke",
    coverage: ["operator-surface", "timeline"],
  },
  {
    id: "director-agent-os-entry-projection-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-entry-projection",
    tier: "smoke",
    coverage: ["host-api", "entry-session"],
  },
  {
    id: "director-agent-os-extension-matrix-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-extension-matrix",
    tier: "synthetic",
    coverage: ["external-provider", "extension-matrix"],
  },
  {
    id: "director-agent-os-media-understanding-runner-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-media-understanding",
    tier: "real-provider",
    coverage: ["media-understanding", "external-provider", "sandbox"],
  },
  {
    id: "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension",
    tier: "real-provider",
    coverage: [
      "real-non-voice-provider-runner-extension",
      "external-provider",
      "media-analysis",
      "sandbox",
      "runner-intent",
      "process-ledger",
      "non-voice",
    ],
  },
  {
    id: "director-agent-os-desktop-extension-control-plane-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-extension-control-plane",
    tier: "smoke",
    coverage: ["desktop", "extension-matrix", "operator-surface"],
  },
  {
    id: "director-agent-os-host-cli-extension-matrix-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-host-cli-extension-matrix",
    tier: "smoke",
    coverage: ["host-api", "cli", "extension-matrix"],
  },
  {
    id: "director-agent-os-mempalace-real-eval-fixture-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-mempalace-real-eval",
    tier: "real-data",
    coverage: ["memory", "mempalace", "real-data-fixture"],
  },
  {
    id: "director-phase-g2-agent-os-memory-eval-ops-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-eval-ops",
    tier: "real-data",
    coverage: ["memory", "mempalace", "desktop", "operator-surface", "real-data-fixture"],
  },
  {
    id: "director-phase-g3-agent-os-memory-sweep-safety-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety",
    tier: "real-data",
    coverage: ["memory", "mempalace", "real-data-safety", "operator-review"],
  },
  {
    id: "director-phase-g4-agent-os-memory-sweep-safety-ops-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety-ops",
    tier: "real-data",
    coverage: ["memory", "mempalace", "real-data-safety", "desktop", "operator-surface"],
  },
  {
    id: "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization",
    tier: "real-data",
    coverage: ["memory", "mempalace", "real-data-loader", "real-data-anonymization"],
  },
  {
    id: "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-eval-dashboard-maintenance",
    tier: "real-data",
    coverage: ["memory", "mempalace", "memory-eval-dashboard", "maintenance-due"],
  },
  {
    id: "director-agent-os-sandbox-preflight-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-sandbox-preflight",
    tier: "synthetic",
    coverage: ["sandbox", "policy"],
  },
  {
    id: "director-agent-os-sandbox-runtime-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-sandbox-runtime",
    tier: "synthetic",
    coverage: ["sandbox", "backend-admission"],
  },
  {
    id: "director-agent-os-non-voice-release-safety-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-non-voice-release-safety",
    tier: "smoke",
    coverage: ["release-safety", "sandbox", "non-voice"],
  },
  {
    id: "director-phase-cnext-agent-os-runner-scan-migration-batch-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-runner-scan-migration-batch",
    tier: "smoke",
    coverage: [
      "runner-scan-migration-batch",
      "process-runner",
      "browser",
      "media-analysis",
      "sandbox",
      "release-safety",
    ],
  },
  {
    id: "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-notebook-browser-automation-hardening",
    tier: "smoke",
    coverage: [
      "notebook-browser-automation-hardening",
      "browser",
      "notebook",
      "operator-scope",
      "release-safety",
      "sandbox",
    ],
  },
  {
    id: "director-phase-dnext-agent-os-channel-adapter-v2-template-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-channel-adapter-v2-template",
    tier: "smoke",
    coverage: ["channel-adapter-v2-template", "channel", "runtime-contract", "release-safety"],
  },
  {
    id: "director-phase-uxnext-agent-os-provider-setup-guidance-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-provider-setup-guidance",
    tier: "smoke",
    coverage: [
      "provider-setup-guidance",
      "external-provider",
      "operator-surface",
      "secret-boundary",
    ],
  },
  {
    id: "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness",
    tier: "smoke",
    coverage: [
      "voice-runner-readiness",
      "live-speech-to-text-readiness",
      "live-text-to-speech-readiness",
      "operator-surface",
      "runner-intent",
      "release-safety",
    ],
  },
  {
    id: "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator",
    tier: "smoke",
    coverage: [
      "voice-evidence-manifest-validator",
      "live-speech-to-text-evidence-manifest",
      "live-text-to-speech-evidence-manifest",
      "operator-surface",
      "runner-intent",
      "release-safety",
    ],
  },
  {
    id: "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission",
    tier: "smoke",
    coverage: [
      "voice-provider-matrix-runner-admission",
      "live-speech-to-text-runner-admission",
      "live-text-to-speech-runner-admission",
      "operator-surface",
      "runner-intent",
      "release-safety",
    ],
  },
  {
    id: "director-agent-os-skill-evolution-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-evolution",
    tier: "synthetic",
    coverage: ["skill-evolution", "operator-review"],
  },
  {
    id: "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-patch-editor-diff-confirmation",
    tier: "synthetic",
    coverage: ["skill-evolution", "skill-patch-editor-diff-confirmation", "operator-review"],
  },
  {
    id: "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-failure-to-patch-eval",
    tier: "synthetic",
    coverage: ["skill-evolution", "skill-failure-to-patch-eval", "operator-review"],
  },
  {
    id: "director-agent-os-subagents-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-subagents",
    tier: "synthetic",
    coverage: ["subagent", "scheduler", "write-set"],
  },
  {
    id: "director-phase-fnext-agent-os-bounded-scheduler-executor-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-bounded-scheduler-executor",
    tier: "synthetic",
    coverage: ["subagent", "scheduler", "scheduler-executor", "write-set"],
  },
  {
    id: "director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-child-git-diff-observed-write-set",
    tier: "synthetic",
    coverage: ["subagent", "git-diff-observed-write-set", "write-set"],
  },
  {
    id: "director-phase-fnext-agent-os-executable-recovery-workflow-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-executable-recovery-workflow",
    tier: "synthetic",
    coverage: ["subagent", "scheduler-recovery", "write-set", "operator-confirmation"],
  },
  {
    id: "director-phase-h2-agent-os-desktop-release-ops-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-release-ops",
    tier: "smoke",
    coverage: ["desktop", "operator-surface", "release-checklist"],
  },
  {
    id: "director-phase-h3-agent-os-release-smoke-readiness-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-readiness",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-readiness"],
  },
  {
    id: "director-phase-h4-agent-os-release-smoke-admission-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-admission",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-admission"],
  },
  {
    id: "director-phase-h5-agent-os-release-smoke-execution-preflight-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-execution-preflight",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-execution-preflight"],
  },
  {
    id: "director-phase-h6-agent-os-release-smoke-evidence-intake-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-intake",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-evidence-intake"],
  },
  {
    id: "director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-preflight",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-evidence-manifest-preflight"],
  },
  {
    id: "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "live-smoke-evidence-manifest-validation"],
  },
  {
    id: "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-evidence-manifest-path-authorization",
    ],
  },
  {
    id: "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-evidence-manifest-schema-validator-readiness",
    ],
  },
  {
    id: "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-evidence-manifest-schema-definition-binding",
    ],
  },
  {
    id: "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-evidence-manifest-read-authorization",
    ],
  },
  {
    id: "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-evidence-manifest-audit-artifact-readiness",
    ],
  },
  {
    id: "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
    tier: "smoke",
    coverage: [
      "release-checklist",
      "operator-surface",
      "live-smoke-runner-intent-signing-revocation",
    ],
  },
  {
    id: "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact",
    tier: "smoke",
    coverage: ["desktop", "operator-surface", "desktop-smoke-evidence-artifact"],
  },
  {
    id: "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
    tier: "smoke",
    coverage: ["desktop", "operator-surface", "desktop-smoke-manual-run-artifact-validator"],
  },
  {
    id: "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype",
    tier: "smoke",
    coverage: ["release-checklist", "operator-surface", "controlled-runner-intent-token-prototype"],
  },
  {
    id: "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
    command: "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate",
    tier: "real-provider",
    coverage: [
      "media-understanding",
      "external-provider",
      "sandbox",
      "non-voice-provider-smoke-candidate",
    ],
  },
];

const requiredCoverageAreas = [
  "desktop",
  "weixin",
  "channel-adapter-v2-template",
  "host-api",
  "external-provider",
  "sandbox",
  "skill-evolution",
  "skill-patch-editor-diff-confirmation",
  "skill-failure-to-patch-eval",
  "subagent",
  "memory",
  "real-data-fixture",
  "real-data-safety",
  "real-data-loader",
  "real-data-anonymization",
  "memory-eval-dashboard",
  "maintenance-due",
  "release-safety",
  "live-smoke-readiness",
  "live-smoke-admission",
  "live-smoke-execution-preflight",
  "live-smoke-evidence-intake",
  "live-smoke-evidence-manifest-preflight",
  "live-smoke-evidence-manifest-validation",
  "live-smoke-evidence-manifest-path-authorization",
  "live-smoke-evidence-manifest-schema-validator-readiness",
  "live-smoke-evidence-manifest-schema-definition-binding",
  "live-smoke-evidence-manifest-read-authorization",
  "live-smoke-evidence-manifest-audit-artifact-readiness",
  "live-smoke-runner-intent-signing-revocation",
  "desktop-smoke-evidence-artifact",
  "desktop-smoke-manual-run-artifact-validator",
  "controlled-runner-intent-token-prototype",
  "non-voice-provider-smoke-candidate",
  "real-non-voice-provider-runner-extension",
  "runner-scan-migration-batch",
  "process-runner",
  "notebook-browser-automation-hardening",
  "notebook",
  "operator-scope",
  "voice-runner-readiness",
  "voice-evidence-manifest-validator",
  "voice-provider-matrix-runner-admission",
  "live-speech-to-text-readiness",
  "live-text-to-speech-readiness",
  "live-speech-to-text-evidence-manifest",
  "live-text-to-speech-evidence-manifest",
  "live-speech-to-text-runner-admission",
  "live-text-to-speech-runner-admission",
  "scheduler-executor",
  "git-diff-observed-write-set",
];

const requiredTiers = ["smoke", "synthetic", "real-provider", "real-data"];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

function fileExists(relativePath) {
  try {
    return statSync(resolve(repoRoot, relativePath)).isFile();
  } catch {
    return false;
  }
}

function manifestSuiteById(id) {
  return waveSuites.find((suite) => suite.id === id);
}

function evaluateManifestCoverage() {
  return requiredAgentOsSuites.map((requiredSuite) => {
    const suite = manifestSuiteById(requiredSuite.id);
    const issues = [];
    if (suite === undefined) {
      issues.push("missing from wave-suite-manifest");
    } else {
      if (suite.command !== requiredSuite.command) {
        issues.push(`command mismatch: expected ${requiredSuite.command}, got ${suite.command}`);
      }
      if (suite.required !== true) {
        issues.push("suite must be required");
      }
      if (suite.kind !== "gate") {
        issues.push(`suite kind must be gate, got ${String(suite.kind)}`);
      }
    }
    return {
      ...requiredSuite,
      status: issues.length === 0 ? "passed" : "failed",
      issues,
    };
  });
}

function evaluatePackageScripts() {
  const rootPackage = readJson("package.json");
  const benchmarkPackage = readJson("benchmarks/package.json");
  const issues = [];
  const expectedBenchmarkScript = "node ./scripts/director-agent-os-all-gate.mjs";
  const expectedRootScript = "pnpm --dir benchmarks bench:director-agent-os-all";
  const expectedDesktopOpsBenchmarkScript =
    "node ./scripts/director-phase-h2-agent-os-desktop-release-ops-gate.mjs";
  const expectedDesktopOpsRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-desktop-release-ops";
  const expectedReleaseSmokeReadinessBenchmarkScript =
    "node ./scripts/director-phase-h3-agent-os-release-smoke-readiness-gate.mjs";
  const expectedReleaseSmokeReadinessRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-readiness";
  const expectedReleaseSmokeAdmissionBenchmarkScript =
    "node ./scripts/director-phase-h4-agent-os-release-smoke-admission-gate.mjs";
  const expectedReleaseSmokeAdmissionRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-admission";
  const expectedReleaseSmokeExecutionPreflightBenchmarkScript =
    "node ./scripts/director-phase-h5-agent-os-release-smoke-execution-preflight-gate.mjs";
  const expectedReleaseSmokeExecutionPreflightRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-execution-preflight";
  const expectedReleaseSmokeEvidenceIntakeBenchmarkScript =
    "node ./scripts/director-phase-h6-agent-os-release-smoke-evidence-intake-gate.mjs";
  const expectedReleaseSmokeEvidenceIntakeRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-intake";
  const expectedReleaseSmokeEvidenceManifestPreflightBenchmarkScript =
    "node ./scripts/director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestPreflightRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-preflight";
  const expectedReleaseSmokeEvidenceManifestValidationBenchmarkScript =
    "node ./scripts/director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestValidationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation";
  const expectedReleaseSmokeEvidenceManifestPathAuthorizationBenchmarkScript =
    "node ./scripts/director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestPathAuthorizationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization";
  const expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessBenchmarkScript =
    "node ./scripts/director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness";
  const expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingBenchmarkScript =
    "node ./scripts/director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding";
  const expectedReleaseSmokeEvidenceManifestReadAuthorizationBenchmarkScript =
    "node ./scripts/director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestReadAuthorizationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization";
  const expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessBenchmarkScript =
    "node ./scripts/director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate.mjs";
  const expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness";
  const expectedReleaseSmokeRunnerIntentSigningRevocationBenchmarkScript =
    "node ./scripts/director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate.mjs";
  const expectedReleaseSmokeRunnerIntentSigningRevocationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation";
  const expectedDesktopSmokeEvidenceArtifactBenchmarkScript =
    "node ./scripts/director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate.mjs";
  const expectedDesktopSmokeEvidenceArtifactRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact";
  const expectedDesktopSmokeManualRunArtifactValidatorBenchmarkScript =
    "node ./scripts/director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate.mjs";
  const expectedDesktopSmokeManualRunArtifactValidatorRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator";
  const expectedControlledRunnerIntentTokenPrototypeBenchmarkScript =
    "node ./scripts/director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate.mjs";
  const expectedControlledRunnerIntentTokenPrototypeRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype";
  const expectedNonVoiceProviderSmokeCandidateBenchmarkScript =
    "node ./scripts/director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate.mjs";
  const expectedNonVoiceProviderSmokeCandidateRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate";
  const expectedRealNonVoiceProviderRunnerExtensionBenchmarkScript =
    "node ./scripts/director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate.mjs";
  const expectedRealNonVoiceProviderRunnerExtensionRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension";
  const expectedRunnerScanMigrationBatchBenchmarkScript =
    "node ./scripts/director-phase-cnext-agent-os-runner-scan-migration-batch-gate.mjs";
  const expectedRunnerScanMigrationBatchRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-runner-scan-migration-batch";
  const expectedNotebookBrowserAutomationHardeningBenchmarkScript =
    "node ./scripts/director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate.mjs";
  const expectedNotebookBrowserAutomationHardeningRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-notebook-browser-automation-hardening";
  const expectedChannelAdapterV2TemplateBenchmarkScript =
    "node ./scripts/director-phase-dnext-agent-os-channel-adapter-v2-template-gate.mjs";
  const expectedChannelAdapterV2TemplateRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-channel-adapter-v2-template";
  const expectedVoiceRunnerReadinessBenchmarkScript =
    "node ./scripts/director-phase-voicenext-agent-os-voice-runner-readiness-gate.mjs";
  const expectedVoiceRunnerReadinessRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness";
  const expectedVoiceEvidenceManifestValidatorBenchmarkScript =
    "node ./scripts/director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate.mjs";
  const expectedVoiceEvidenceManifestValidatorRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator";
  const expectedVoiceProviderMatrixRunnerAdmissionBenchmarkScript =
    "node ./scripts/director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate.mjs";
  const expectedVoiceProviderMatrixRunnerAdmissionRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission";
  const expectedBoundedSchedulerExecutorBenchmarkScript =
    "node ./scripts/director-phase-fnext-agent-os-bounded-scheduler-executor-gate.mjs";
  const expectedBoundedSchedulerExecutorRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-bounded-scheduler-executor";
  const expectedChildGitDiffObservedWriteSetBenchmarkScript =
    "node ./scripts/director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate.mjs";
  const expectedChildGitDiffObservedWriteSetRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-child-git-diff-observed-write-set";
  const expectedSkillPatchEditorDiffConfirmationBenchmarkScript =
    "node ./scripts/director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate.mjs";
  const expectedSkillPatchEditorDiffConfirmationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-skill-patch-editor-diff-confirmation";
  const expectedSkillFailureToPatchEvalBenchmarkScript =
    "node ./scripts/director-phase-enext-agent-os-skill-failure-to-patch-eval-gate.mjs";
  const expectedSkillFailureToPatchEvalRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-skill-failure-to-patch-eval";
  const expectedMemoryEvalOpsBenchmarkScript =
    "node ./scripts/director-phase-g2-agent-os-memory-eval-ops-gate.mjs";
  const expectedMemoryEvalOpsRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-memory-eval-ops";
  const expectedMemorySweepSafetyBenchmarkScript =
    "node ./scripts/director-phase-g3-agent-os-memory-sweep-safety-gate.mjs";
  const expectedMemorySweepSafetyRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety";
  const expectedMemorySweepSafetyOpsBenchmarkScript =
    "node ./scripts/director-phase-g4-agent-os-memory-sweep-safety-ops-gate.mjs";
  const expectedMemorySweepSafetyOpsRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety-ops";
  const expectedMemoryDatasetLoaderAnonymizationBenchmarkScript =
    "node ./scripts/director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate.mjs";
  const expectedMemoryDatasetLoaderAnonymizationRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization";
  const expectedMemoryEvalDashboardMaintenanceBenchmarkScript =
    "node ./scripts/director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate.mjs";
  const expectedMemoryEvalDashboardMaintenanceRootScript =
    "pnpm --dir benchmarks bench:director-agent-os-memory-eval-dashboard-maintenance";

  if (benchmarkPackage.scripts?.["bench:director-agent-os-all"] !== expectedBenchmarkScript) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-all=${expectedBenchmarkScript}`,
    );
  }
  if (rootPackage.scripts?.["bench:director-agent-os-all"] !== expectedRootScript) {
    issues.push(`root package missing bench:director-agent-os-all=${expectedRootScript}`);
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-desktop-release-ops"] !==
    expectedDesktopOpsBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-desktop-release-ops=${expectedDesktopOpsBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-desktop-release-ops"] !==
    expectedDesktopOpsRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-desktop-release-ops=${expectedDesktopOpsRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-release-smoke-readiness"] !==
    expectedReleaseSmokeReadinessBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-readiness=${expectedReleaseSmokeReadinessBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-readiness"] !==
    expectedReleaseSmokeReadinessRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-readiness=${expectedReleaseSmokeReadinessRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-release-smoke-admission"] !==
    expectedReleaseSmokeAdmissionBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-admission=${expectedReleaseSmokeAdmissionBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-admission"] !==
    expectedReleaseSmokeAdmissionRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-admission=${expectedReleaseSmokeAdmissionRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-release-smoke-execution-preflight"] !==
    expectedReleaseSmokeExecutionPreflightBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-execution-preflight=${expectedReleaseSmokeExecutionPreflightBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-execution-preflight"] !==
    expectedReleaseSmokeExecutionPreflightRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-execution-preflight=${expectedReleaseSmokeExecutionPreflightRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-release-smoke-evidence-intake"] !==
    expectedReleaseSmokeEvidenceIntakeBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-intake=${expectedReleaseSmokeEvidenceIntakeBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-evidence-intake"] !==
    expectedReleaseSmokeEvidenceIntakeRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-intake=${expectedReleaseSmokeEvidenceIntakeRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-preflight"
    ] !== expectedReleaseSmokeEvidenceManifestPreflightBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-preflight=${expectedReleaseSmokeEvidenceManifestPreflightBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-evidence-manifest-preflight"] !==
    expectedReleaseSmokeEvidenceManifestPreflightRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-preflight=${expectedReleaseSmokeEvidenceManifestPreflightRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-validation"
    ] !== expectedReleaseSmokeEvidenceManifestValidationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-validation=${expectedReleaseSmokeEvidenceManifestValidationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-release-smoke-evidence-manifest-validation"] !==
    expectedReleaseSmokeEvidenceManifestValidationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-validation=${expectedReleaseSmokeEvidenceManifestValidationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-path-authorization"
    ] !== expectedReleaseSmokeEvidenceManifestPathAuthorizationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-path-authorization=${expectedReleaseSmokeEvidenceManifestPathAuthorizationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-path-authorization"
    ] !== expectedReleaseSmokeEvidenceManifestPathAuthorizationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-path-authorization=${expectedReleaseSmokeEvidenceManifestPathAuthorizationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness"
    ] !== expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness=${expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness"
    ] !== expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness=${expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding"
    ] !== expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding=${expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding"
    ] !== expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding=${expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-read-authorization"
    ] !== expectedReleaseSmokeEvidenceManifestReadAuthorizationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-read-authorization=${expectedReleaseSmokeEvidenceManifestReadAuthorizationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-read-authorization"
    ] !== expectedReleaseSmokeEvidenceManifestReadAuthorizationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-read-authorization=${expectedReleaseSmokeEvidenceManifestReadAuthorizationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness"
    ] !== expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness=${expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness"
    ] !== expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness=${expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-release-smoke-runner-intent-signing-revocation"
    ] !== expectedReleaseSmokeRunnerIntentSigningRevocationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-release-smoke-runner-intent-signing-revocation=${expectedReleaseSmokeRunnerIntentSigningRevocationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.[
      "bench:director-agent-os-release-smoke-runner-intent-signing-revocation"
    ] !== expectedReleaseSmokeRunnerIntentSigningRevocationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-release-smoke-runner-intent-signing-revocation=${expectedReleaseSmokeRunnerIntentSigningRevocationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-desktop-smoke-evidence-artifact"] !==
    expectedDesktopSmokeEvidenceArtifactBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-desktop-smoke-evidence-artifact=${expectedDesktopSmokeEvidenceArtifactBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-desktop-smoke-evidence-artifact"] !==
    expectedDesktopSmokeEvidenceArtifactRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-desktop-smoke-evidence-artifact=${expectedDesktopSmokeEvidenceArtifactRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-desktop-smoke-manual-run-artifact-validator"
    ] !== expectedDesktopSmokeManualRunArtifactValidatorBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-desktop-smoke-manual-run-artifact-validator=${expectedDesktopSmokeManualRunArtifactValidatorBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-desktop-smoke-manual-run-artifact-validator"] !==
    expectedDesktopSmokeManualRunArtifactValidatorRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-desktop-smoke-manual-run-artifact-validator=${expectedDesktopSmokeManualRunArtifactValidatorRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-controlled-runner-intent-token-prototype"
    ] !== expectedControlledRunnerIntentTokenPrototypeBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-controlled-runner-intent-token-prototype=${expectedControlledRunnerIntentTokenPrototypeBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-controlled-runner-intent-token-prototype"] !==
    expectedControlledRunnerIntentTokenPrototypeRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-controlled-runner-intent-token-prototype=${expectedControlledRunnerIntentTokenPrototypeRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-non-voice-provider-smoke-candidate"] !==
    expectedNonVoiceProviderSmokeCandidateBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-non-voice-provider-smoke-candidate=${expectedNonVoiceProviderSmokeCandidateBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-non-voice-provider-smoke-candidate"] !==
    expectedNonVoiceProviderSmokeCandidateRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-non-voice-provider-smoke-candidate=${expectedNonVoiceProviderSmokeCandidateRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.[
      "bench:director-agent-os-real-non-voice-provider-runner-extension"
    ] !== expectedRealNonVoiceProviderRunnerExtensionBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-real-non-voice-provider-runner-extension=${expectedRealNonVoiceProviderRunnerExtensionBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-real-non-voice-provider-runner-extension"] !==
    expectedRealNonVoiceProviderRunnerExtensionRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-real-non-voice-provider-runner-extension=${expectedRealNonVoiceProviderRunnerExtensionRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-runner-scan-migration-batch"] !==
    expectedRunnerScanMigrationBatchBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-runner-scan-migration-batch=${expectedRunnerScanMigrationBatchBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-runner-scan-migration-batch"] !==
    expectedRunnerScanMigrationBatchRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-runner-scan-migration-batch=${expectedRunnerScanMigrationBatchRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-notebook-browser-automation-hardening"] !==
    expectedNotebookBrowserAutomationHardeningBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-notebook-browser-automation-hardening=${expectedNotebookBrowserAutomationHardeningBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-notebook-browser-automation-hardening"] !==
    expectedNotebookBrowserAutomationHardeningRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-notebook-browser-automation-hardening=${expectedNotebookBrowserAutomationHardeningRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-bounded-scheduler-executor"] !==
    expectedBoundedSchedulerExecutorBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-bounded-scheduler-executor=${expectedBoundedSchedulerExecutorBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-bounded-scheduler-executor"] !==
    expectedBoundedSchedulerExecutorRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-bounded-scheduler-executor=${expectedBoundedSchedulerExecutorRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-child-git-diff-observed-write-set"] !==
    expectedChildGitDiffObservedWriteSetBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-child-git-diff-observed-write-set=${expectedChildGitDiffObservedWriteSetBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-child-git-diff-observed-write-set"] !==
    expectedChildGitDiffObservedWriteSetRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-child-git-diff-observed-write-set=${expectedChildGitDiffObservedWriteSetRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-memory-eval-ops"] !==
    expectedMemoryEvalOpsBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-memory-eval-ops=${expectedMemoryEvalOpsBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-memory-eval-ops"] !==
    expectedMemoryEvalOpsRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-memory-eval-ops=${expectedMemoryEvalOpsRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-memory-sweep-safety"] !==
    expectedMemorySweepSafetyBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-memory-sweep-safety=${expectedMemorySweepSafetyBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-memory-sweep-safety"] !==
    expectedMemorySweepSafetyRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-memory-sweep-safety=${expectedMemorySweepSafetyRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-memory-sweep-safety-ops"] !==
    expectedMemorySweepSafetyOpsBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-memory-sweep-safety-ops=${expectedMemorySweepSafetyOpsBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-memory-sweep-safety-ops"] !==
    expectedMemorySweepSafetyOpsRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-memory-sweep-safety-ops=${expectedMemorySweepSafetyOpsRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-memory-dataset-loader-anonymization"] !==
    expectedMemoryDatasetLoaderAnonymizationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-memory-dataset-loader-anonymization=${expectedMemoryDatasetLoaderAnonymizationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-memory-dataset-loader-anonymization"] !==
    expectedMemoryDatasetLoaderAnonymizationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-memory-dataset-loader-anonymization=${expectedMemoryDatasetLoaderAnonymizationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-memory-eval-dashboard-maintenance"] !==
    expectedMemoryEvalDashboardMaintenanceBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-memory-eval-dashboard-maintenance=${expectedMemoryEvalDashboardMaintenanceBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-memory-eval-dashboard-maintenance"] !==
    expectedMemoryEvalDashboardMaintenanceRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-memory-eval-dashboard-maintenance=${expectedMemoryEvalDashboardMaintenanceRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-skill-patch-editor-diff-confirmation"] !==
    expectedSkillPatchEditorDiffConfirmationBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-skill-patch-editor-diff-confirmation=${expectedSkillPatchEditorDiffConfirmationBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-skill-patch-editor-diff-confirmation"] !==
    expectedSkillPatchEditorDiffConfirmationRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-skill-patch-editor-diff-confirmation=${expectedSkillPatchEditorDiffConfirmationRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-skill-failure-to-patch-eval"] !==
    expectedSkillFailureToPatchEvalBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-skill-failure-to-patch-eval=${expectedSkillFailureToPatchEvalBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-skill-failure-to-patch-eval"] !==
    expectedSkillFailureToPatchEvalRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-skill-failure-to-patch-eval=${expectedSkillFailureToPatchEvalRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-channel-adapter-v2-template"] !==
    expectedChannelAdapterV2TemplateBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-channel-adapter-v2-template=${expectedChannelAdapterV2TemplateBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-channel-adapter-v2-template"] !==
    expectedChannelAdapterV2TemplateRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-channel-adapter-v2-template=${expectedChannelAdapterV2TemplateRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-voice-runner-readiness"] !==
    expectedVoiceRunnerReadinessBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-voice-runner-readiness=${expectedVoiceRunnerReadinessBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-voice-runner-readiness"] !==
    expectedVoiceRunnerReadinessRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-voice-runner-readiness=${expectedVoiceRunnerReadinessRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-voice-evidence-manifest-validator"] !==
    expectedVoiceEvidenceManifestValidatorBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-voice-evidence-manifest-validator=${expectedVoiceEvidenceManifestValidatorBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-voice-evidence-manifest-validator"] !==
    expectedVoiceEvidenceManifestValidatorRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-voice-evidence-manifest-validator=${expectedVoiceEvidenceManifestValidatorRootScript}`,
    );
  }
  if (
    benchmarkPackage.scripts?.["bench:director-agent-os-voice-provider-matrix-runner-admission"] !==
    expectedVoiceProviderMatrixRunnerAdmissionBenchmarkScript
  ) {
    issues.push(
      `benchmarks package missing bench:director-agent-os-voice-provider-matrix-runner-admission=${expectedVoiceProviderMatrixRunnerAdmissionBenchmarkScript}`,
    );
  }
  if (
    rootPackage.scripts?.["bench:director-agent-os-voice-provider-matrix-runner-admission"] !==
    expectedVoiceProviderMatrixRunnerAdmissionRootScript
  ) {
    issues.push(
      `root package missing bench:director-agent-os-voice-provider-matrix-runner-admission=${expectedVoiceProviderMatrixRunnerAdmissionRootScript}`,
    );
  }

  return {
    status: issues.length === 0 ? "passed" : "failed",
    issues,
  };
}

function evaluateAllGateSource() {
  const scriptPath = "benchmarks/scripts/director-agent-os-all-gate.mjs";
  const issues = [];
  if (!fileExists(scriptPath)) {
    issues.push(`${scriptPath} does not exist`);
    return {
      status: "failed",
      issues,
    };
  }

  const content = readFileSync(resolve(repoRoot, scriptPath), "utf8");
  const requiredNeedles = [
    "missing-auth",
    "missing-local-service",
    "provider-disabled",
    "unsafe-environment",
    "real-provider",
    "real-data",
    "director-agent-os-non-voice-release-safety-gate",
    "director-agent-os-mempalace-real-eval-fixture-gate",
    "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
    "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
    "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
    "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
    "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
    "director-phase-cnext-agent-os-runner-scan-migration-batch-gate",
    "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate",
    "director-phase-dnext-agent-os-channel-adapter-v2-template-gate",
    "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate",
    "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate",
    "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
    "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
    "director-phase-fnext-agent-os-bounded-scheduler-executor-gate",
    "director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate",
    "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate",
    "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate",
  ];
  for (const needle of requiredNeedles) {
    if (!content.includes(needle)) {
      issues.push(`${scriptPath} missing ${needle}`);
    }
  }

  return {
    status: issues.length === 0 ? "passed" : "failed",
    issues,
  };
}

function evaluateCoverageAreas(manifestCoverage) {
  const coveredAreas = new Set(
    manifestCoverage.filter((item) => item.status === "passed").flatMap((item) => item.coverage),
  );
  const coveredTiers = new Set(
    manifestCoverage.filter((item) => item.status === "passed").map((item) => item.tier),
  );
  const missingAreas = requiredCoverageAreas.filter((area) => !coveredAreas.has(area));
  const missingTiers = requiredTiers.filter((tier) => !coveredTiers.has(tier));
  const issues = [
    ...missingAreas.map((area) => `missing coverage area ${area}`),
    ...missingTiers.map((tier) => `missing tier ${tier}`),
  ];
  return {
    status: issues.length === 0 ? "passed" : "failed",
    requiredCoverageAreas,
    coveredAreas: [...coveredAreas].sort(),
    requiredTiers,
    coveredTiers: [...coveredTiers].sort(),
    issues,
  };
}

mkdirSync(resultsDir, { recursive: true });

const manifestCoverage = evaluateManifestCoverage();
const packageScripts = evaluatePackageScripts();
const allGateSource = evaluateAllGateSource();
const coverageAreas = evaluateCoverageAreas(manifestCoverage);
const failures = [
  ...manifestCoverage
    .filter((item) => item.status !== "passed")
    .map((item) => `${item.id}: ${item.issues.join("; ")}`),
  ...packageScripts.issues.map((issue) => `package-scripts: ${issue}`),
  ...allGateSource.issues.map((issue) => `agent-os-all-source: ${issue}`),
  ...coverageAreas.issues.map((issue) => `coverage: ${issue}`),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    requiredSuites: requiredAgentOsSuites.length,
    manifestPassed: manifestCoverage.filter((item) => item.status === "passed").length,
    coverageAreas: requiredCoverageAreas.length,
    coverageTiers: requiredTiers.length,
    failed: failures.length,
    note: "Phase H.1 coverage gate: verifies Agent OS release eval has required smoke, synthetic, real-provider, and real-data gates without starting new provider daemons.",
  },
  manifestCoverage,
  packageScripts,
  allGateSource,
  coverageAreas,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release suite coverage gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Manifest coverage: ${report.summary.manifestPassed}/${report.summary.requiredSuites}, failures: ${failures.length}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS release suite coverage gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
