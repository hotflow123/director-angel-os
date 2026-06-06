import { createHash } from "node:crypto";

import type {
  MempalaceRecallItem,
  MempalaceRecallResult,
  MempalaceSearchRawItem,
} from "./types.js";

export const MEMPALACE_RECALL_BENCHMARK_FIXTURE_SCHEMA_VERSION =
  "hotflow.mempalace.recall-benchmark.fixture.v1" as const;
export const MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION =
  "hotflow.mempalace.recall-dataset-manifest.v1" as const;

export interface MempalaceRecallBenchmarkFixtureSource {
  readonly name: string;
  readonly localOnly?: boolean;
  readonly dataset?: string;
  readonly version?: string;
}

export interface MempalaceRecallBenchmarkThresholds {
  readonly recallAtK?: number;
  readonly recallAnyAtK?: number;
  readonly recallAllAtK?: number;
  readonly ndcgAtK?: number;
  readonly requireVerbatimEvidence?: boolean;
  readonly requireProvenanceEvidence?: boolean;
  readonly allowDegraded?: boolean;
}

export interface EvaluateMempalaceRecallBenchmarkCase {
  readonly queryId: string;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly result: MempalaceRecallResult;
  readonly k?: number;
}

export interface EvaluateMempalaceRecallBenchmarkInput {
  readonly suiteId: string;
  readonly cases: readonly EvaluateMempalaceRecallBenchmarkCase[];
}

export interface EvaluateMempalaceRecallBenchmarkFixtureCase {
  readonly queryId: string;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly k?: number;
  readonly result?: MempalaceRecallResult;
  readonly mempalaceResult?: unknown;
}

export interface EvaluateMempalaceRecallBenchmarkFixtureInput {
  readonly schemaVersion: typeof MEMPALACE_RECALL_BENCHMARK_FIXTURE_SCHEMA_VERSION;
  readonly suiteId: string;
  readonly source?: MempalaceRecallBenchmarkFixtureSource;
  readonly thresholds?: MempalaceRecallBenchmarkThresholds;
  readonly cases: readonly EvaluateMempalaceRecallBenchmarkFixtureCase[];
}

export interface MempalaceRecallBenchmarkEvidence {
  readonly id: string;
  readonly score: number;
  readonly retrievalEngine?: string;
  readonly matchMode?: string;
  readonly sourceFile?: string;
  readonly hasVerbatim: boolean;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface MempalaceRecallBenchmarkCaseResult {
  readonly queryId: string;
  readonly query: string;
  readonly outcome: MempalaceRecallResult["outcome"];
  readonly k: number;
  readonly expectedCount: number;
  readonly hitCount: number;
  readonly foundCount: number;
  readonly recallAtK: number;
  readonly recallAnyAtK: number;
  readonly recallAllAtK: number;
  readonly ndcgAtK: number;
  readonly retrievedIdsAtK: readonly string[];
  readonly foundExpectedIds: readonly string[];
  readonly missingExpectedIds: readonly string[];
  readonly evidenceAtK: readonly MempalaceRecallBenchmarkEvidence[];
  readonly degradedReason?: string;
}

export interface MempalaceRecallBenchmarkReport {
  readonly suiteId: string;
  readonly summary: {
    readonly caseCount: number;
    readonly failed: number;
    readonly averages: {
      readonly recallAtK: number;
      readonly recallAnyAtK: number;
      readonly recallAllAtK: number;
      readonly ndcgAtK: number;
    };
  };
  readonly results: readonly MempalaceRecallBenchmarkCaseResult[];
  readonly failures: readonly {
    readonly queryId: string;
    readonly missingExpectedIds: readonly string[];
    readonly degradedReason?: string;
  }[];
}

export interface MempalaceRecallBenchmarkFixtureReport extends MempalaceRecallBenchmarkReport {
  readonly schemaVersion: typeof MEMPALACE_RECALL_BENCHMARK_FIXTURE_SCHEMA_VERSION;
  readonly source?: MempalaceRecallBenchmarkFixtureSource;
  readonly thresholds: MempalaceRecallBenchmarkThresholds;
}

export interface MempalaceRecallBenchmarkThresholdResult {
  readonly status: "failed" | "passed";
  readonly thresholds: MempalaceRecallBenchmarkThresholds;
  readonly failures: readonly string[];
}

export interface MempalaceRecallDatasetManifestResultItem {
  readonly id: string;
  readonly text: string;
  readonly verbatim?: string;
  readonly sourceFile?: string;
  readonly wing?: string;
  readonly room?: string;
  readonly score?: number;
}

export interface MempalaceRecallDatasetManifestCase {
  readonly queryId: string;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly k?: number;
  readonly results: readonly MempalaceRecallDatasetManifestResultItem[];
}

export interface MempalaceRecallDatasetManifestInput {
  readonly schemaVersion: typeof MEMPALACE_RECALL_DATASET_MANIFEST_SCHEMA_VERSION;
  readonly suiteId?: string;
  readonly source?: Omit<MempalaceRecallBenchmarkFixtureSource, "localOnly"> & {
    readonly localOnly?: boolean;
  };
  readonly thresholds?: MempalaceRecallBenchmarkThresholds;
  readonly dataset: MempalaceLiveMemoryEvalSweepDataset;
  readonly approval: MempalaceLiveMemoryEvalSweepApproval;
  readonly anonymization: MempalaceLiveMemoryEvalSweepAnonymization;
  readonly retention: MempalaceLiveMemoryEvalSweepRetention;
  readonly execution: MempalaceLiveMemoryEvalSweepExecution;
  readonly cases: readonly MempalaceRecallDatasetManifestCase[];
}

export interface MempalaceRecallDatasetManifestAnonymizationReport {
  readonly schemaVersion: "hotflow.mempalace.recall-dataset-anonymization.v1";
  readonly strategy: string;
  readonly irreversible: boolean;
  readonly removedDirectIdentifiers: boolean;
  readonly rawContentStored: false;
  readonly redactionCount: number;
  readonly anonymizedCaseCount: number;
  readonly anonymizedResultCount: number;
}

export interface MempalaceRecallDatasetManifestLoadResult {
  readonly status: "blocked" | "ready";
  readonly safetyPlan: MempalaceLiveMemoryEvalSweepPlan;
  readonly anonymization: MempalaceRecallDatasetManifestAnonymizationReport;
  readonly fixture?: EvaluateMempalaceRecallBenchmarkFixtureInput;
}

export type MempalaceLiveMemoryEvalSourceKind =
  | "local-fixture"
  | "public-benchmark"
  | "live-user-memory";

export type MempalaceLiveMemoryEvalApprovalScope =
  | "fixture-only"
  | "public-benchmark-eval"
  | "live-user-memory-eval";

export type MempalaceLiveMemoryEvalBlockReason =
  | "operator-approval-required"
  | "approval-scope-insufficient"
  | "approval-id-required"
  | "approval-timestamp-required"
  | "anonymization-required"
  | "irreversible-anonymization-required"
  | "direct-identifier-redaction-required"
  | "raw-content-storage-forbidden"
  | "delete-raw-content-after-eval-required"
  | "retention-ttl-required"
  | "retention-ttl-too-long"
  | "dry-run-required"
  | "network-disabled-required"
  | "readonly-required"
  | "dataset-id-required"
  | "case-count-required";

export interface MempalaceLiveMemoryEvalSweepDataset {
  readonly datasetId: string;
  readonly sourceKind: MempalaceLiveMemoryEvalSourceKind;
  readonly localOnly: boolean;
  readonly containsUserContent: boolean;
  readonly estimatedCaseCount?: number;
}

export interface MempalaceLiveMemoryEvalSweepApproval {
  readonly operatorApproved: boolean;
  readonly approvalId?: string;
  readonly scope?: MempalaceLiveMemoryEvalApprovalScope;
  readonly approvedAt?: string;
}

export interface MempalaceLiveMemoryEvalSweepAnonymization {
  readonly enabled: boolean;
  readonly strategy: string;
  readonly irreversible?: boolean;
  readonly removesDirectIdentifiers?: boolean;
}

export interface MempalaceLiveMemoryEvalSweepRetention {
  readonly reportTtlDays?: number;
  readonly storeRawContent: boolean;
  readonly deleteRawContentAfterEval: boolean;
}

export interface MempalaceLiveMemoryEvalSweepExecution {
  readonly dryRunOnly: boolean;
  readonly allowNetwork: boolean;
  readonly readOnly: boolean;
}

export interface PlanMempalaceLiveMemoryEvalSweepInput {
  readonly sweepId: string;
  readonly dataset: MempalaceLiveMemoryEvalSweepDataset;
  readonly approval: MempalaceLiveMemoryEvalSweepApproval;
  readonly anonymization: MempalaceLiveMemoryEvalSweepAnonymization;
  readonly retention: MempalaceLiveMemoryEvalSweepRetention;
  readonly execution: MempalaceLiveMemoryEvalSweepExecution;
}

export interface MempalaceLiveMemoryEvalSafetyEnvelope {
  readonly sourceKind: MempalaceLiveMemoryEvalSourceKind;
  readonly localOnly: boolean;
  readonly dryRunOnly: boolean;
  readonly allowNetwork: boolean;
  readonly readOnly: boolean;
  readonly storeRawContent: boolean;
  readonly reportTtlDays?: number;
  readonly anonymizationStrategy: string;
  readonly approvalScope?: MempalaceLiveMemoryEvalApprovalScope;
}

export interface MempalaceLiveMemoryEvalSweepPlan {
  readonly schemaVersion: "hotflow.mempalace.live-memory-eval-safety.v1";
  readonly sweepId: string;
  readonly status: "blocked" | "ready";
  readonly readyToRun: boolean;
  readonly canReadUserData: false;
  readonly reasonCodes: readonly MempalaceLiveMemoryEvalBlockReason[];
  readonly operatorChecklist: readonly string[];
  readonly safetyEnvelope: MempalaceLiveMemoryEvalSafetyEnvelope;
  readonly inputSummary: PlanMempalaceLiveMemoryEvalSweepInput;
}

export function evaluateMempalaceRecallBenchmark(
  input: EvaluateMempalaceRecallBenchmarkInput,
): MempalaceRecallBenchmarkReport {
  const results = input.cases.map((item) => evaluateMempalaceRecallBenchmarkCase(item));
  const failures = results
    .filter((item) => item.missingExpectedIds.length > 0 || item.degradedReason !== undefined)
    .map((item) => ({
      queryId: item.queryId,
      missingExpectedIds: item.missingExpectedIds,
      ...(item.degradedReason === undefined ? {} : { degradedReason: item.degradedReason }),
    }));

  return {
    suiteId: input.suiteId,
    summary: {
      caseCount: results.length,
      failed: failures.length,
      averages: {
        recallAtK: averageMetric(results.map((item) => item.recallAtK)),
        recallAnyAtK: averageMetric(results.map((item) => item.recallAnyAtK)),
        recallAllAtK: averageMetric(results.map((item) => item.recallAllAtK)),
        ndcgAtK: averageMetric(results.map((item) => item.ndcgAtK)),
      },
    },
    results,
    failures,
  };
}

export function evaluateMempalaceRecallBenchmarkFixture(
  input: EvaluateMempalaceRecallBenchmarkFixtureInput,
): MempalaceRecallBenchmarkFixtureReport {
  const report = evaluateMempalaceRecallBenchmark({
    suiteId: input.suiteId,
    cases: input.cases.map((item) => ({
      queryId: item.queryId,
      query: item.query,
      expectedIds: item.expectedIds,
      result: item.result ?? createMempalaceRecallResultFromFixturePayload(item.mempalaceResult),
      ...(item.k === undefined ? {} : { k: item.k }),
    })),
  });

  return {
    ...report,
    schemaVersion: input.schemaVersion,
    ...(input.source === undefined ? {} : { source: input.source }),
    thresholds: input.thresholds ?? {},
  };
}

export function evaluateMempalaceRecallBenchmarkThresholds(
  report: MempalaceRecallBenchmarkReport,
  thresholds: MempalaceRecallBenchmarkThresholds = {},
): MempalaceRecallBenchmarkThresholdResult {
  const failures: string[] = [];
  assertMetricThreshold(
    "recall@k",
    report.summary.averages.recallAtK,
    thresholds.recallAtK,
    failures,
  );
  assertMetricThreshold(
    "recallAny@k",
    report.summary.averages.recallAnyAtK,
    thresholds.recallAnyAtK,
    failures,
  );
  assertMetricThreshold(
    "recallAll@k",
    report.summary.averages.recallAllAtK,
    thresholds.recallAllAtK,
    failures,
  );
  assertMetricThreshold("ndcg@k", report.summary.averages.ndcgAtK, thresholds.ndcgAtK, failures);

  for (const failure of report.failures) {
    if (failure.missingExpectedIds.length > 0) {
      failures.push(
        `case ${failure.queryId} is missing expected IDs: ${failure.missingExpectedIds.join(", ")}.`,
      );
    }
    if (failure.degradedReason !== undefined && thresholds.allowDegraded !== true) {
      failures.push(`case ${failure.queryId} degraded: ${failure.degradedReason}.`);
    }
  }

  for (const result of report.results) {
    for (const evidence of result.evidenceAtK) {
      if (thresholds.requireVerbatimEvidence === true && !evidence.hasVerbatim) {
        failures.push(`case ${result.queryId} evidence ${evidence.id} is missing verbatim text.`);
      }
      if (thresholds.requireProvenanceEvidence === true && evidence.provenance === undefined) {
        failures.push(`case ${result.queryId} evidence ${evidence.id} is missing provenance.`);
      }
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    thresholds,
    failures,
  };
}

export function planMempalaceLiveMemoryEvalSweep(
  input: PlanMempalaceLiveMemoryEvalSweepInput,
): MempalaceLiveMemoryEvalSweepPlan {
  const reasonCodes = dedupeReasonCodes([
    ...validateLiveMemoryEvalDataset(input.dataset),
    ...validateLiveMemoryEvalApproval(input.dataset, input.approval),
    ...validateLiveMemoryEvalAnonymization(input.dataset, input.anonymization),
    ...validateLiveMemoryEvalRetention(input.retention),
    ...validateLiveMemoryEvalExecution(input.execution),
  ]);

  return {
    schemaVersion: "hotflow.mempalace.live-memory-eval-safety.v1",
    sweepId: input.sweepId,
    status: reasonCodes.length === 0 ? "ready" : "blocked",
    readyToRun: reasonCodes.length === 0,
    canReadUserData: false,
    reasonCodes,
    operatorChecklist: createLiveMemoryEvalOperatorChecklist(reasonCodes, input),
    safetyEnvelope: {
      sourceKind: input.dataset.sourceKind,
      localOnly: input.dataset.localOnly,
      dryRunOnly: input.execution.dryRunOnly,
      allowNetwork: input.execution.allowNetwork,
      readOnly: input.execution.readOnly,
      storeRawContent: input.retention.storeRawContent,
      ...(input.retention.reportTtlDays === undefined
        ? {}
        : { reportTtlDays: input.retention.reportTtlDays }),
      anonymizationStrategy: input.anonymization.strategy,
      ...(input.approval.scope === undefined ? {} : { approvalScope: input.approval.scope }),
    },
    inputSummary: input,
  };
}

export function loadMempalaceRecallDatasetManifestFixture(
  input: MempalaceRecallDatasetManifestInput,
): MempalaceRecallDatasetManifestLoadResult {
  const safetyPlan = planMempalaceLiveMemoryEvalSweep({
    sweepId: `dataset-loader:${input.dataset.datasetId}`,
    dataset: input.dataset,
    approval: input.approval,
    anonymization: input.anonymization,
    retention: input.retention,
    execution: input.execution,
  });
  const anonymizedCases = input.cases.map((item) => anonymizeDatasetManifestCase(item));
  const anonymizationReport = createDatasetManifestAnonymizationReport(input, anonymizedCases);

  if (safetyPlan.status !== "ready") {
    return {
      status: "blocked",
      safetyPlan,
      anonymization: anonymizationReport,
    };
  }

  return {
    status: "ready",
    safetyPlan,
    anonymization: anonymizationReport,
    fixture: {
      schemaVersion: MEMPALACE_RECALL_BENCHMARK_FIXTURE_SCHEMA_VERSION,
      suiteId: input.suiteId ?? `${input.dataset.datasetId}-anonymized-recall-fixture`,
      source: {
        name: input.source?.name ?? input.dataset.datasetId,
        localOnly: true,
        dataset: input.source?.dataset ?? input.dataset.datasetId,
        ...(input.source?.version === undefined ? {} : { version: input.source.version }),
      },
      thresholds: input.thresholds ?? {},
      cases: anonymizedCases.map((item) => item.case),
    },
  };
}

function validateLiveMemoryEvalDataset(
  dataset: MempalaceLiveMemoryEvalSweepDataset,
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  const reasons: MempalaceLiveMemoryEvalBlockReason[] = [];
  if (dataset.datasetId.trim().length === 0) {
    reasons.push("dataset-id-required");
  }
  if (
    dataset.estimatedCaseCount !== undefined &&
    (!Number.isFinite(dataset.estimatedCaseCount) || dataset.estimatedCaseCount < 1)
  ) {
    reasons.push("case-count-required");
  }
  return reasons;
}

function validateLiveMemoryEvalApproval(
  dataset: MempalaceLiveMemoryEvalSweepDataset,
  approval: MempalaceLiveMemoryEvalSweepApproval,
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  if (!requiresOperatorApproval(dataset)) {
    return [];
  }
  const reasons: MempalaceLiveMemoryEvalBlockReason[] = [];
  if (!approval.operatorApproved) {
    reasons.push("operator-approval-required");
  }
  if (approval.operatorApproved && readString(approval.approvalId) === undefined) {
    reasons.push("approval-id-required");
  }
  if (approval.operatorApproved && readString(approval.approvedAt) === undefined) {
    reasons.push("approval-timestamp-required");
  }
  const requiredScope = requiredLiveMemoryEvalApprovalScope(dataset);
  if (approval.operatorApproved && approval.scope !== requiredScope) {
    reasons.push("approval-scope-insufficient");
  }
  return reasons;
}

function validateLiveMemoryEvalAnonymization(
  dataset: MempalaceLiveMemoryEvalSweepDataset,
  anonymization: MempalaceLiveMemoryEvalSweepAnonymization,
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  if (!requiresAnonymization(dataset)) {
    return [];
  }
  const reasons: MempalaceLiveMemoryEvalBlockReason[] = [];
  if (!anonymization.enabled || anonymization.strategy === "none") {
    reasons.push("anonymization-required");
  }
  if (anonymization.irreversible !== true) {
    reasons.push("irreversible-anonymization-required");
  }
  if (anonymization.removesDirectIdentifiers !== true) {
    reasons.push("direct-identifier-redaction-required");
  }
  return reasons;
}

function validateLiveMemoryEvalRetention(
  retention: MempalaceLiveMemoryEvalSweepRetention,
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  const reasons: MempalaceLiveMemoryEvalBlockReason[] = [];
  if (retention.storeRawContent) {
    reasons.push("raw-content-storage-forbidden");
  }
  if (!retention.deleteRawContentAfterEval) {
    reasons.push("delete-raw-content-after-eval-required");
  }
  if (retention.reportTtlDays === undefined || !Number.isFinite(retention.reportTtlDays)) {
    reasons.push("retention-ttl-required");
  } else if (retention.reportTtlDays > 30) {
    reasons.push("retention-ttl-too-long");
  }
  return reasons;
}

function validateLiveMemoryEvalExecution(
  execution: MempalaceLiveMemoryEvalSweepExecution,
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  const reasons: MempalaceLiveMemoryEvalBlockReason[] = [];
  if (!execution.dryRunOnly) {
    reasons.push("dry-run-required");
  }
  if (execution.allowNetwork) {
    reasons.push("network-disabled-required");
  }
  if (!execution.readOnly) {
    reasons.push("readonly-required");
  }
  return reasons;
}

function requiresOperatorApproval(dataset: MempalaceLiveMemoryEvalSweepDataset): boolean {
  return dataset.sourceKind !== "local-fixture" || dataset.containsUserContent;
}

function requiresAnonymization(dataset: MempalaceLiveMemoryEvalSweepDataset): boolean {
  return dataset.containsUserContent || dataset.sourceKind === "live-user-memory";
}

function requiredLiveMemoryEvalApprovalScope(
  dataset: MempalaceLiveMemoryEvalSweepDataset,
): MempalaceLiveMemoryEvalApprovalScope {
  if (dataset.sourceKind === "live-user-memory") {
    return "live-user-memory-eval";
  }
  if (dataset.sourceKind === "public-benchmark") {
    return "public-benchmark-eval";
  }
  return "fixture-only";
}

function createLiveMemoryEvalOperatorChecklist(
  reasonCodes: readonly MempalaceLiveMemoryEvalBlockReason[],
  input: PlanMempalaceLiveMemoryEvalSweepInput,
): readonly string[] {
  const checklist = [
    `dataset ${input.dataset.datasetId || "(missing)"} source=${input.dataset.sourceKind}`,
    "operator approval: required before any live user-memory eval sweep",
    "anonymization: irreversible direct identifier removal before evaluation",
    "retention: no raw content storage and report TTL <= 30 days",
    "execution: dry-run, read-only, network disabled until a separate live runner is approved",
  ];
  if (reasonCodes.length === 0) {
    return [...checklist, "status: ready for dry-run planning only"];
  }
  return [...checklist, `blocked: ${reasonCodes.join(", ")}`];
}

function anonymizeDatasetManifestCase(input: MempalaceRecallDatasetManifestCase): {
  readonly case: EvaluateMempalaceRecallBenchmarkFixtureCase;
  readonly redactionCount: number;
} {
  const resultIdMap = new Map(input.results.map((item) => [item.id, anonymizeDatasetId(item.id)]));
  const expectedIds = input.expectedIds.map((id) =>
    normalizeMempalaceHitId(resultIdMap.get(id) ?? anonymizeDatasetId(id)),
  );
  let redactionCount = 0;
  const query = redactDatasetText(input.query);
  redactionCount += query.redactionCount;

  const results = input.results.map((item) => {
    const text = redactDatasetText(item.text);
    const verbatim = item.verbatim === undefined ? undefined : redactDatasetText(item.verbatim);
    redactionCount += text.redactionCount + (verbatim?.redactionCount ?? 0);
    const anonymizedId = resultIdMap.get(item.id) ?? anonymizeDatasetId(item.id);
    const anonymizedSourceFile =
      item.sourceFile === undefined
        ? undefined
        : anonymizeDatasetMetadataValue("source", item.sourceFile);
    const anonymizedWing =
      item.wing === undefined ? undefined : anonymizeDatasetMetadataValue("wing", item.wing);
    const anonymizedRoom =
      item.room === undefined ? undefined : anonymizeDatasetMetadataValue("room", item.room);
    return {
      id: anonymizedId,
      text: text.value,
      ...(verbatim === undefined ? {} : { verbatim: verbatim.value }),
      similarity: item.score ?? 1,
      matched_via: "dataset-loader",
      ...(anonymizedSourceFile === undefined ? {} : { source_file: anonymizedSourceFile }),
      ...(anonymizedWing === undefined ? {} : { wing: anonymizedWing }),
      ...(anonymizedRoom === undefined ? {} : { room: anonymizedRoom }),
      metadata: {
        anonymized: true,
        originalIdHash: hashToken(item.id),
        ...(item.sourceFile === undefined
          ? {}
          : { originalSourceFileHash: hashToken(item.sourceFile) }),
        provenance: {
          engine: "mempalace",
          anonymized: true,
          sourceKind: "dataset-loader",
          ...(anonymizedSourceFile === undefined ? {} : { sourceFile: anonymizedSourceFile }),
          ...(anonymizedWing === undefined ? {} : { wing: anonymizedWing }),
          ...(anonymizedRoom === undefined ? {} : { room: anonymizedRoom }),
        },
      },
    };
  });

  return {
    case: {
      queryId: anonymizeDatasetMetadataValue("case", input.queryId),
      query: query.value,
      expectedIds,
      ...(input.k === undefined ? {} : { k: input.k }),
      mempalaceResult: {
        ok: true,
        results,
      },
    },
    redactionCount,
  };
}

function createDatasetManifestAnonymizationReport(
  input: MempalaceRecallDatasetManifestInput,
  anonymizedCases: readonly {
    readonly redactionCount: number;
    readonly case: EvaluateMempalaceRecallBenchmarkFixtureCase;
  }[],
): MempalaceRecallDatasetManifestAnonymizationReport {
  return {
    schemaVersion: "hotflow.mempalace.recall-dataset-anonymization.v1",
    strategy: input.anonymization.strategy,
    irreversible: input.anonymization.irreversible === true,
    removedDirectIdentifiers: input.anonymization.removesDirectIdentifiers === true,
    rawContentStored: false,
    redactionCount: anonymizedCases.reduce((sum, item) => sum + item.redactionCount, 0),
    anonymizedCaseCount: anonymizedCases.length,
    anonymizedResultCount: anonymizedCases.reduce(
      (sum, item) => sum + readRawItems(item.case.mempalaceResult).length,
      0,
    ),
  };
}

function anonymizeDatasetId(value: string): string {
  return `anon_${hashToken(value).slice("sha256:".length, "sha256:".length + 16)}`;
}

function anonymizeDatasetMetadataValue(prefix: string, value: string): string {
  return `${prefix}_${hashToken(value).slice("sha256:".length, "sha256:".length + 16)}`;
}

function redactDatasetText(value: string): {
  readonly value: string;
  readonly redactionCount: number;
} {
  const replacements = [
    {
      pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
      label: "email",
    },
    {
      pattern: /\+?\d[\d\s().-]{7,}\d/gu,
      label: "phone",
    },
    {
      pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/gu,
      label: "person",
    },
  ] as const;
  let output = value;
  let redactionCount = 0;
  for (const replacement of replacements) {
    output = output.replace(replacement.pattern, (match) => {
      redactionCount += 1;
      return `[redacted:${replacement.label}:${hashToken(match).slice("sha256:".length, "sha256:".length + 12)}]`;
    });
  }
  return { value: output, redactionCount };
}

function hashToken(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function dedupeReasonCodes(
  values: readonly MempalaceLiveMemoryEvalBlockReason[],
): readonly MempalaceLiveMemoryEvalBlockReason[] {
  return [...new Set(values)];
}

function evaluateMempalaceRecallBenchmarkCase(
  input: EvaluateMempalaceRecallBenchmarkCase,
): MempalaceRecallBenchmarkCaseResult {
  const expectedIds = dedupeIds(input.expectedIds);
  const k = normalizeK(input.k, input.result.items.length);
  const sortedHits = [...input.result.items].sort((left, right) => right.score - left.score);
  const hitsAtK = sortedHits.slice(0, k);
  const retrievedIdsAtK = dedupeIds(hitsAtK.map((item) => normalizeMempalaceHitId(item.id)));
  const expectedSet = new Set(expectedIds);
  const foundExpectedIds = retrievedIdsAtK.filter((id) => expectedSet.has(id));
  const foundSet = new Set(foundExpectedIds);
  const missingExpectedIds = expectedIds.filter((id) => !foundSet.has(id));
  const expectedCount = expectedIds.length;
  const foundCount = foundExpectedIds.length;

  return {
    queryId: input.queryId,
    query: input.query,
    outcome: input.result.outcome,
    k,
    expectedCount,
    hitCount: input.result.items.length,
    foundCount,
    recallAtK: expectedCount === 0 ? 1 : roundMetric(foundCount / expectedCount),
    recallAnyAtK: expectedCount === 0 || foundCount > 0 ? 1 : 0,
    recallAllAtK: expectedCount === 0 || foundCount === expectedCount ? 1 : 0,
    ndcgAtK: roundMetric(computeNdcgAtK(retrievedIdsAtK, expectedSet, k, expectedCount)),
    retrievedIdsAtK,
    foundExpectedIds,
    missingExpectedIds,
    evidenceAtK: hitsAtK.map((item) => toBenchmarkEvidence(item)),
    ...(input.result.degraded?.reason === undefined
      ? {}
      : { degradedReason: input.result.degraded.reason }),
  };
}

function createMempalaceRecallResultFromFixturePayload(payload: unknown): MempalaceRecallResult {
  const items = mapMempalaceFixtureItems(readRawItems(payload));
  const degradedReason = readPayloadDegradedReason(payload);
  return {
    outcome: degradedReason === undefined ? "ok" : "degraded",
    items,
    ...(degradedReason === undefined
      ? {}
      : {
          degraded: {
            reason: degradedReason,
            message: readPayloadDegradedMessage(payload) ?? degradedReason,
          },
        }),
    details: {
      fixture: true,
      itemCount: items.length,
    },
  };
}

function mapMempalaceFixtureItems(
  items: readonly MempalaceSearchRawItem[],
): readonly MempalaceRecallItem[] {
  return items
    .map((item, index): MempalaceRecallItem | undefined => {
      const content =
        readString(item.text) ??
        readString(item.content) ??
        readString(item.memory) ??
        readString(item.verbatim);
      if (content === undefined) {
        return undefined;
      }
      const id =
        readString(item.id) ?? readString(item.memory_id) ?? `mempalace-fixture-${index + 1}`;
      const score = readScore(item);
      const wing = readString(item.wing);
      const room = readString(item.room);
      const sourceFile = readString(item.source_file);
      const matchMode = readString(item.matched_via);
      const bm25Score = readNumber(item.bm25_score);
      const distance = readNumber(item.distance);
      const effectiveDistance = readNumber(item.effective_distance);
      const closetBoost = readNumber(item.closet_boost);
      const drawerIndex = readInteger(item.drawer_index);
      const totalDrawers = readInteger(item.total_drawers);
      const rawMetadata = readRecord(item.metadata);
      const verbatim = readString(item.verbatim);
      const provenance = buildFixtureProvenance({
        ...(rawMetadata === undefined ? {} : { rawMetadata }),
        ...(sourceFile === undefined ? {} : { sourceFile }),
        ...(wing === undefined ? {} : { wing }),
        ...(room === undefined ? {} : { room }),
        ...(drawerIndex === undefined ? {} : { drawerIndex }),
        ...(totalDrawers === undefined ? {} : { totalDrawers }),
      });
      const metadata = {
        ...(sourceFile === undefined ? {} : { sourceFile }),
        retrievalEngine: "mempalace",
        matchMode: matchMode ?? "vector",
        vectorSimilarity: score,
        ...(verbatim === undefined ? {} : { verbatim }),
        ...(bm25Score === undefined ? {} : { bm25Score }),
        ...(distance === undefined ? {} : { distance }),
        ...(effectiveDistance === undefined ? {} : { effectiveDistance }),
        ...(closetBoost === undefined ? {} : { closetBoost }),
        ...(drawerIndex === undefined ? {} : { drawerIndex }),
        ...(totalDrawers === undefined ? {} : { totalDrawers }),
        ...(rawMetadata === undefined ? {} : { rawMetadata }),
        ...(provenance === undefined ? {} : { provenance }),
      };

      return {
        id,
        content,
        score,
        updatedAt: readInteger(item.updatedAt) ?? readInteger(item.timestamp) ?? 0,
        ...(wing === undefined ? {} : { wing }),
        ...(room === undefined ? {} : { room }),
        metadata,
      };
    })
    .filter((item): item is MempalaceRecallItem => Boolean(item))
    .sort((left, right) => right.score - left.score);
}

function buildFixtureProvenance(input: {
  readonly rawMetadata?: Readonly<Record<string, unknown>>;
  readonly sourceFile?: string;
  readonly wing?: string;
  readonly room?: string;
  readonly drawerIndex?: number;
  readonly totalDrawers?: number;
}): Readonly<Record<string, unknown>> | undefined {
  const rawProvenance = readRecord(input.rawMetadata?.provenance);
  if (rawProvenance !== undefined) {
    return rawProvenance;
  }
  if (
    input.sourceFile === undefined &&
    input.wing === undefined &&
    input.room === undefined &&
    input.drawerIndex === undefined &&
    input.totalDrawers === undefined
  ) {
    return undefined;
  }
  return {
    engine: "mempalace",
    ...(input.sourceFile === undefined ? {} : { sourceFile: input.sourceFile }),
    ...(input.wing === undefined ? {} : { wing: input.wing }),
    ...(input.room === undefined ? {} : { room: input.room }),
    ...(input.drawerIndex === undefined ? {} : { drawerIndex: input.drawerIndex }),
    ...(input.totalDrawers === undefined ? {} : { totalDrawers: input.totalDrawers }),
  };
}

function readRawItems(payload: unknown): readonly MempalaceSearchRawItem[] {
  if (Array.isArray(payload)) {
    return payload as readonly MempalaceSearchRawItem[];
  }
  if (payload && typeof payload === "object") {
    const record = payload as Readonly<Record<string, unknown>>;
    if (Array.isArray(record.results)) {
      return record.results as readonly MempalaceSearchRawItem[];
    }
    if (Array.isArray(record.items)) {
      return record.items as readonly MempalaceSearchRawItem[];
    }
  }
  return [];
}

function readPayloadDegradedReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return "mempalace-fixture-missing-result";
  }
  const record = payload as Readonly<Record<string, unknown>>;
  if (record.ok === false) {
    return readString(record.reason) ?? "mempalace-fixture-result-not-ok";
  }
  const degraded = readRecord(record.degraded);
  return readString(degraded?.reason);
}

function readPayloadDegradedMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Readonly<Record<string, unknown>>;
  const degraded = readRecord(record.degraded);
  return readString(degraded?.message) ?? readString(record.message);
}

function toBenchmarkEvidence(item: MempalaceRecallItem): MempalaceRecallBenchmarkEvidence {
  const metadata = item.metadata ?? {};
  const retrievalEngine = readString(metadata.retrievalEngine);
  const matchMode = readString(metadata.matchMode);
  const sourceFile = readString(metadata.sourceFile);
  const provenance = readRecord(metadata.provenance);

  return {
    id: normalizeMempalaceHitId(item.id),
    score: item.score,
    ...(retrievalEngine === undefined ? {} : { retrievalEngine }),
    ...(matchMode === undefined ? {} : { matchMode }),
    ...(sourceFile === undefined ? {} : { sourceFile }),
    hasVerbatim: readString(metadata.verbatim) !== undefined,
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function normalizeMempalaceHitId(id: string): string {
  return id.startsWith("mempalace:") ? id : `mempalace:${id}`;
}

function computeNdcgAtK(
  retrievedIdsAtK: readonly string[],
  expectedSet: ReadonlySet<string>,
  k: number,
  expectedCount: number,
): number {
  if (expectedCount === 0) {
    return 1;
  }
  const relevances = retrievedIdsAtK.slice(0, k).map((id) => (expectedSet.has(id) ? 1 : 0));
  const dcg = computeDcg(relevances);
  const idealDcg = computeDcg(Array.from({ length: Math.min(k, expectedCount) }, () => 1));
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function computeDcg(relevances: readonly number[]): number {
  return relevances.reduce((sum, relevance, index) => {
    return sum + relevance / Math.log2(index + 2);
  }, 0);
}

function normalizeK(value: number | undefined, hitCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(1, hitCount);
  }
  return Math.max(1, Math.trunc(value));
}

function dedupeIds(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function averageMetric(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function assertMetricThreshold(
  name: string,
  actual: number,
  expected: number | undefined,
  failures: string[],
): void {
  if (expected !== undefined && actual < expected) {
    failures.push(`${name} expected >= ${expected} but received ${actual}.`);
  }
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function readScore(item: MempalaceSearchRawItem): number {
  const rawScore = readNumber(item.score) ?? readNumber(item.similarity) ?? 0;
  return Math.max(0, Math.min(1, rawScore));
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
