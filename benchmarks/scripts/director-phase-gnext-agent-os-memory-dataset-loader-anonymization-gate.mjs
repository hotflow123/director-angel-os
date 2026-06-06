import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION,
  evaluateMempalaceRecallBenchmarkFixture,
  evaluateMempalaceRecallBenchmarkThresholds,
  loadMempalaceRecallDatasetManifestFixture,
} from "../../services/mempalace-adapter/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate";
const fixturePath = resolve(
  repoRoot,
  "benchmarks/fixtures/director-agent-os-mempalace-real-dataset-loader-mini.json",
);
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const rawLeakChecks = [
  { label: "person-mira", value: "Mira" },
  { label: "person-mira-lower", value: "mira" },
  { label: "email-mira", value: "mira@example.com" },
  { label: "phone-mira", value: "415 555 0188" },
  { label: "person-sam", value: "Sam" },
  { label: "person-sam-lower", value: "sam" },
  { label: "email-sam", value: "sam@example.com" },
  { label: "source-mira", value: "mira-session" },
  { label: "source-sam", value: "sam-secretref" },
  { label: "id-mira", value: "drawer_mira" },
  { label: "id-sam", value: "drawer_sam" },
];

const requiredSourceCoverage = [
  {
    id: "mempalace-dataset-loader-contract",
    path: "services/mempalace-adapter/src/recall-benchmark.ts",
    checks: [
      {
        label: "loader-api",
        pattern: "loadMempalaceRecallDatasetManifestFixture",
      },
      {
        label: "manifest-schema-version",
        pattern: "MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION",
      },
      {
        label: "no-raw-content-storage",
        pattern: "rawContentStored: false",
      },
      {
        label: "no-user-data-capability",
        pattern: "canReadUserData: false",
      },
      {
        label: "metadata-anonymization",
        pattern: "anonymizeDatasetMetadataValue",
      },
      {
        label: "source-file-hash",
        pattern: "originalSourceFileHash",
      },
      {
        label: "direct-identifier-redaction",
        pattern: "direct-identifier-redaction-required",
      },
      {
        label: "retention-ttl-boundary",
        pattern: "retention-ttl-too-long",
      },
      {
        label: "network-disabled",
        pattern: "network-disabled-required",
      },
    ],
  },
  {
    id: "mempalace-dataset-loader-export",
    path: "services/mempalace-adapter/src/index.ts",
    checks: [
      {
        label: "loader-export",
        pattern: "loadMempalaceRecallDatasetManifestFixture",
      },
      {
        label: "manifest-schema-export",
        pattern: "MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION",
      },
      {
        label: "load-result-type-export",
        pattern: "MempalaceRecallDatasetManifestLoadResult",
      },
    ],
  },
  {
    id: "mempalace-dataset-loader-tests",
    path: "services/mempalace-adapter/tests/mempalace-adapter.test.ts",
    checks: [
      {
        label: "loader-test",
        pattern: "loadMempalaceRecallDatasetManifestFixture",
      },
      {
        label: "raw-lowercase-leak-test",
        pattern: 'not.toContain("mira")',
      },
      {
        label: "anonymized-expected-id-test",
        pattern: "expectedIds: [expect.stringMatching(/^mempalace:anon_/u)]",
      },
      {
        label: "metadata-source-hash-test",
        pattern: "originalSourceFileHash",
      },
    ],
  },
  {
    id: "mempalace-dataset-loader-fixture",
    path: "benchmarks/fixtures/director-agent-os-mempalace-real-dataset-loader-mini.json",
    checks: [
      {
        label: "manifest-schema-fixture",
        pattern: MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION,
      },
      {
        label: "public-benchmark-scope",
        pattern: '"scope": "public-benchmark-eval"',
      },
      {
        label: "dry-run-fixture",
        pattern: '"dryRunOnly": true',
      },
      {
        label: "network-disabled-fixture",
        pattern: '"allowNetwork": false',
      },
      {
        label: "no-raw-content-fixture",
        pattern: '"storeRawContent": false',
      },
    ],
  },
];

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
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
    const missingChecks =
      sourceLoadError === null
        ? item.checks.filter((check) => !text.includes(check.pattern)).map((check) => check.label)
        : item.checks.map((check) => check.label);
    return {
      id: item.id,
      path: item.path,
      status: missingChecks.length === 0 ? "passed" : "failed",
      missingChecks,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function createUnsafeManifest() {
  return {
    ...fixture,
    suiteId: "director-agent-os-mempalace-real-dataset-loader-unsafe",
    approval: {
      operatorApproved: false,
    },
    anonymization: {
      enabled: false,
      strategy: "none",
    },
    retention: {
      reportTtlDays: 120,
      storeRawContent: true,
      deleteRawContentAfterEval: false,
    },
    execution: {
      dryRunOnly: false,
      allowNetwork: true,
      readOnly: false,
    },
  };
}

function fixtureResultItems(item) {
  const payload = item.mempalaceResult;
  if (payload && typeof payload === "object" && Array.isArray(payload.results)) {
    return payload.results;
  }
  return [];
}

function evaluateBehaviorCoverage() {
  const blocked = loadMempalaceRecallDatasetManifestFixture(createUnsafeManifest());
  const ready = loadMempalaceRecallDatasetManifestFixture(fixture);
  const issues = [];
  const expectedBlockedReasons = [
    "operator-approval-required",
    "anonymization-required",
    "irreversible-anonymization-required",
    "direct-identifier-redaction-required",
    "raw-content-storage-forbidden",
    "delete-raw-content-after-eval-required",
    "retention-ttl-too-long",
    "dry-run-required",
    "network-disabled-required",
    "readonly-required",
  ];

  if (blocked.status !== "blocked" || blocked.fixture !== undefined) {
    issues.push("unsafe manifest must be blocked without emitting a fixture");
  }
  for (const reason of expectedBlockedReasons) {
    if (!blocked.safetyPlan.reasonCodes.includes(reason)) {
      issues.push(`blocked manifest missing reason ${reason}`);
    }
  }
  if (blocked.anonymization.rawContentStored !== false) {
    issues.push("blocked manifest must still report rawContentStored=false");
  }
  if (blocked.safetyPlan.canReadUserData !== false) {
    issues.push("blocked manifest must not grant user-data read capability");
  }

  if (ready.status !== "ready" || ready.fixture === undefined) {
    issues.push("approved anonymized manifest should emit a ready recall fixture");
  }
  if (
    ready.safetyPlan.readyToRun !== true ||
    ready.safetyPlan.canReadUserData !== false ||
    ready.safetyPlan.safetyEnvelope.storeRawContent !== false ||
    ready.safetyPlan.safetyEnvelope.reportTtlDays > 30 ||
    ready.safetyPlan.safetyEnvelope.allowNetwork !== false ||
    ready.safetyPlan.safetyEnvelope.dryRunOnly !== true ||
    ready.safetyPlan.safetyEnvelope.readOnly !== true
  ) {
    issues.push("ready manifest safety envelope must stay dry-run, read-only, no-network, no-raw");
  }
  if (
    ready.anonymization.rawContentStored !== false ||
    ready.anonymization.irreversible !== true ||
    ready.anonymization.removedDirectIdentifiers !== true ||
    ready.anonymization.redactionCount < 6
  ) {
    issues.push("ready manifest anonymization report must prove irreversible direct redaction");
  }

  const generatedFixture = ready.fixture;
  const serializedFixture = JSON.stringify(generatedFixture);
  for (const check of rawLeakChecks) {
    if (serializedFixture.includes(check.value)) {
      issues.push(`generated fixture leaks ${check.label}`);
    }
  }
  for (const marker of [
    "[redacted:person:",
    "[redacted:email:",
    "[redacted:phone:",
    "mempalace:anon_",
    "source_",
    "case_",
    "originalSourceFileHash",
  ]) {
    if (!serializedFixture.includes(marker)) {
      issues.push(`generated fixture missing anonymization marker ${marker}`);
    }
  }

  for (const item of generatedFixture?.cases ?? []) {
    if (!item.queryId.startsWith("case_")) {
      issues.push(`case ${item.queryId} should use anonymized queryId`);
    }
    for (const expectedId of item.expectedIds) {
      if (!expectedId.startsWith("mempalace:anon_")) {
        issues.push(`case ${item.queryId} has non-anonymized expectedId`);
      }
    }
    for (const result of fixtureResultItems(item)) {
      if (!String(result.id ?? "").startsWith("anon_")) {
        issues.push(`case ${item.queryId} has non-anonymized result id`);
      }
      if (!String(result.source_file ?? "").startsWith("source_")) {
        issues.push(`case ${item.queryId} has non-anonymized source_file`);
      }
      if (!String(result.metadata?.originalIdHash ?? "").startsWith("sha256:")) {
        issues.push(`case ${item.queryId} is missing original id hash evidence`);
      }
      if (!String(result.metadata?.originalSourceFileHash ?? "").startsWith("sha256:")) {
        issues.push(`case ${item.queryId} is missing original source hash evidence`);
      }
      if (!String(result.metadata?.provenance?.sourceFile ?? "").startsWith("source_")) {
        issues.push(`case ${item.queryId} has non-anonymized provenance sourceFile`);
      }
    }
  }

  const qualityReport =
    generatedFixture === undefined
      ? undefined
      : evaluateMempalaceRecallBenchmarkFixture(generatedFixture);
  const qualityThresholds =
    qualityReport === undefined
      ? undefined
      : evaluateMempalaceRecallBenchmarkThresholds(qualityReport, qualityReport.thresholds);
  if (qualityThresholds?.status !== "passed") {
    issues.push("generated anonymized fixture must pass recall benchmark thresholds");
  }

  return {
    id: "mempalace-dataset-loader-anonymization-behavior",
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    blockedSummary: {
      status: blocked.status,
      reasonCodes: blocked.safetyPlan.reasonCodes,
      canReadUserData: blocked.safetyPlan.canReadUserData,
      rawContentStored: blocked.anonymization.rawContentStored,
    },
    readySummary: {
      status: ready.status,
      reasonCodes: ready.safetyPlan.reasonCodes,
      canReadUserData: ready.safetyPlan.canReadUserData,
      safetyEnvelope: ready.safetyPlan.safetyEnvelope,
      anonymization: ready.anonymization,
      generatedCaseCount: generatedFixture?.cases.length ?? 0,
    },
    ...(qualityReport === undefined ? {} : { qualityReport }),
    ...(qualityThresholds === undefined ? {} : { qualityThresholds }),
  };
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = evaluateSourceCoverage();
const behaviorCoverage = evaluateBehaviorCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingChecks.join(", ")} in ${result.path}`,
  ),
  ...behaviorCoverage.issues.map((issue) => `${behaviorCoverage.id}: ${issue}`),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  fixturePath,
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    behaviorCoverage: 1,
    behaviorCoveragePassed: behaviorCoverage.status === "passed" ? 1 : 0,
    failed: failures.length,
    note: "G.next proves local public-benchmark style MemPalace dataset manifests load only after approval, irreversible anonymization, no raw content storage, TTL, dry-run, read-only, and network-disabled constraints; it never reads live user memory datasets.",
  },
  sourceCoverage,
  behaviorCoverage,
  failures,
};

const serializedReport = JSON.stringify(report, null, 2);
for (const check of rawLeakChecks) {
  if (serializedReport.includes(check.value)) {
    failures.push(`gate report leaks ${check.label}`);
  }
}

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS memory dataset loader anonymization gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, behavior coverage: ${report.summary.behaviorCoveragePassed}/${report.summary.behaviorCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS memory dataset loader anonymization gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
