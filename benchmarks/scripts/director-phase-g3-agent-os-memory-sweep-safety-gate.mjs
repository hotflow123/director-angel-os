import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { planMempalaceLiveMemoryEvalSweep } from "../../services/mempalace-adapter/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-g3-agent-os-memory-sweep-safety-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "mempalace-live-memory-eval-safety-contract",
    path: "services/mempalace-adapter/src/recall-benchmark.ts",
    needles: [
      "planMempalaceLiveMemoryEvalSweep",
      '"hotflow.mempalace.live-memory-eval-safety.v1"',
      "operator-approval-required",
      "approval-scope-insufficient",
      "anonymization-required",
      "irreversible-anonymization-required",
      "direct-identifier-redaction-required",
      "raw-content-storage-forbidden",
      "delete-raw-content-after-eval-required",
      "retention-ttl-too-long",
      "dry-run-required",
      "network-disabled-required",
      "readonly-required",
      "canReadUserData: false",
    ],
  },
  {
    id: "mempalace-live-memory-eval-export",
    path: "services/mempalace-adapter/src/index.ts",
    needles: [
      "planMempalaceLiveMemoryEvalSweep",
      "MempalaceLiveMemoryEvalSweepPlan",
      "PlanMempalaceLiveMemoryEvalSweepInput",
    ],
  },
  {
    id: "mempalace-live-memory-eval-tests",
    path: "services/mempalace-adapter/tests/mempalace-adapter.test.ts",
    needles: [
      "planMempalaceLiveMemoryEvalSweep",
      "operator-approval-required",
      "approval-scope-insufficient",
      "anonymization-required",
      "raw-content-storage-forbidden",
      "retention-ttl-too-long",
      "dry-run-required",
      "network-disabled-required",
      "readonly-required",
      "live-user-memory-eval",
      "canReadUserData",
    ],
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
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

function evaluateBehaviorCoverage() {
  const blocked = planMempalaceLiveMemoryEvalSweep({
    sweepId: "live-memory-sweep-missing-safety",
    dataset: {
      datasetId: "user-memory-prod",
      sourceKind: "live-user-memory",
      localOnly: false,
      containsUserContent: true,
      estimatedCaseCount: 25,
    },
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
  });
  const ready = planMempalaceLiveMemoryEvalSweep({
    sweepId: "live-memory-sweep-redacted-dry-run",
    dataset: {
      datasetId: "user-memory-prod-redacted",
      sourceKind: "live-user-memory",
      localOnly: false,
      containsUserContent: true,
      estimatedCaseCount: 25,
    },
    approval: {
      operatorApproved: true,
      approvalId: "approval-live-memory-1",
      scope: "live-user-memory-eval",
      approvedAt: "2026-05-09T04:05:00.000Z",
    },
    anonymization: {
      enabled: true,
      strategy: "hash+entity-redaction",
      irreversible: true,
      removesDirectIdentifiers: true,
    },
    retention: {
      reportTtlDays: 14,
      storeRawContent: false,
      deleteRawContentAfterEval: true,
    },
    execution: {
      dryRunOnly: true,
      allowNetwork: false,
      readOnly: true,
    },
  });
  const expectedBlockedReasons = [
    "operator-approval-required",
    "anonymization-required",
    "raw-content-storage-forbidden",
    "retention-ttl-too-long",
    "dry-run-required",
    "network-disabled-required",
    "readonly-required",
  ];
  const issues = [];
  if (blocked.status !== "blocked" || blocked.readyToRun !== false) {
    issues.push("unsafe live-user-memory sweep must be blocked");
  }
  for (const reason of expectedBlockedReasons) {
    if (!blocked.reasonCodes.includes(reason)) {
      issues.push(`blocked plan missing ${reason}`);
    }
  }
  if (blocked.canReadUserData !== false || ready.canReadUserData !== false) {
    issues.push("preflight must never grant user-data read capability");
  }
  if (ready.status !== "ready" || ready.readyToRun !== true || ready.reasonCodes.length !== 0) {
    issues.push("approved anonymized dry-run plan should be ready");
  }
  if (
    ready.safetyEnvelope.storeRawContent !== false ||
    ready.safetyEnvelope.allowNetwork !== false
  ) {
    issues.push("ready safety envelope must keep raw content off and network disabled");
  }
  return {
    id: "mempalace-live-memory-eval-behavior",
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    blockedSummary: {
      status: blocked.status,
      reasonCodes: blocked.reasonCodes,
      canReadUserData: blocked.canReadUserData,
    },
    readySummary: {
      status: ready.status,
      reasonCodes: ready.reasonCodes,
      canReadUserData: ready.canReadUserData,
      safetyEnvelope: ready.safetyEnvelope,
    },
  };
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
const behaviorCoverage = evaluateBehaviorCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
  ...behaviorCoverage.issues.map((issue) => `${behaviorCoverage.id}: ${issue}`),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    behaviorCoverage: 1,
    behaviorCoveragePassed: behaviorCoverage.status === "passed" ? 1 : 0,
    failed: failures.length,
    note: "Phase G.3 proves future live MemPalace memory eval sweeps have an explicit safety preflight for approval, anonymization, retention, dry-run, read-only, and network-disabled constraints without reading live user datasets.",
  },
  sourceCoverage,
  behaviorCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS memory sweep safety gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, behavior coverage: ${report.summary.behaviorCoveragePassed}/${report.summary.behaviorCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS memory sweep safety gate failed.", failures.join("\n"));
}
