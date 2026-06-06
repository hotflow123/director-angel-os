export type ConversationRuntimeMemoryRecallBenchmarkDomain =
  | "script"
  | "scene"
  | "shot"
  | "asset"
  | "decision"
  | "evidence"
  | (string & {});

export type ConversationRuntimeMemoryRecallBenchmarkHitStatus =
  | "hit"
  | "miss"
  | "degraded"
  | "candidate"
  | (string & {});

export interface ConversationRuntimeMemoryRecallBenchmarkProvenance {
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly traceRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRecallBenchmarkHit {
  readonly id?: string;
  readonly source?: string;
  readonly status?: ConversationRuntimeMemoryRecallBenchmarkHitStatus;
  readonly score?: number;
  readonly latencyMs?: number;
  readonly provenance?: ConversationRuntimeMemoryRecallBenchmarkProvenance;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRecallBenchmarkCase {
  readonly caseId: string;
  readonly domain: ConversationRuntimeMemoryRecallBenchmarkDomain;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly k?: number;
  readonly retrieved: readonly ConversationRuntimeMemoryRecallBenchmarkHit[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRecallBenchmarkSuite {
  readonly schemaVersion: "conversation-runtime.memory-recall-benchmark-suite.v1";
  readonly suiteId: string;
  readonly cases: readonly ConversationRuntimeMemoryRecallBenchmarkCase[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateDirectorMemoryRecallBenchmarkFixtureInput {
  readonly suiteId?: string;
  readonly retrievedByCaseId?: Readonly<
    Record<string, readonly ConversationRuntimeMemoryRecallBenchmarkHit[]>
  >;
  readonly defaultLatencyMs?: number;
  readonly k?: number;
}

export interface EvaluateConversationRuntimeMemoryRecallBenchmarkOptions {
  readonly caseIds?: readonly string[];
  readonly defaultK?: number;
  readonly requireEvidenceRefs?: boolean;
  readonly requireSourceRefs?: boolean;
  readonly requirePolicyEnvelopeRefs?: boolean;
}

export interface ConversationRuntimeMemoryRecallBenchmarkCaseResult {
  readonly caseId: string;
  readonly domain: ConversationRuntimeMemoryRecallBenchmarkDomain;
  readonly query: string;
  readonly k: number;
  readonly expectedCount: number;
  readonly hitCount: number;
  readonly foundCount: number;
  readonly recallAtK: number;
  readonly recallAnyAtK: number;
  readonly recallAllAtK: number;
  readonly ndcgAtK: number;
  readonly provenanceCompleteness: number;
  readonly latencyMs: number;
  readonly retrievedIdsAtK: readonly string[];
  readonly foundExpectedIds: readonly string[];
  readonly missingExpectedIds: readonly string[];
  readonly missingProvenanceHitIds: readonly string[];
}

export type ConversationRuntimeMemoryRecallBenchmarkFailureType =
  | "missing-expected-ids"
  | "missing-provenance";

export interface ConversationRuntimeMemoryRecallBenchmarkFailure {
  readonly caseId: string;
  readonly domain: ConversationRuntimeMemoryRecallBenchmarkDomain;
  readonly type: ConversationRuntimeMemoryRecallBenchmarkFailureType;
  readonly missingExpectedIds?: readonly string[];
  readonly missingProvenanceHitIds?: readonly string[];
}

export interface ConversationRuntimeMemoryRecallBenchmarkReport {
  readonly schemaVersion: "conversation-runtime.memory-recall-benchmark.v1";
  readonly suiteId: string;
  readonly caseCount: number;
  readonly passed: boolean;
  readonly metrics: {
    readonly recallAtK: number;
    readonly recallAnyAtK: number;
    readonly recallAllAtK: number;
    readonly ndcgAtK: number;
    readonly provenanceCompleteness: number;
    readonly averageLatencyMs: number;
    readonly p95LatencyMs: number;
  };
  readonly results: readonly ConversationRuntimeMemoryRecallBenchmarkCaseResult[];
  readonly failures: readonly ConversationRuntimeMemoryRecallBenchmarkFailure[];
}

const DIRECTOR_MEMORY_RECALL_FIXTURE_CASES = [
  {
    caseId: "script-tone-recall",
    domain: "script",
    query: "开场旁白的情绪基调是什么",
    expectedIds: ["script:opening-voiceover"],
  },
  {
    caseId: "scene-blocking-recall",
    domain: "scene",
    query: "雨夜天桥这场戏的调度重点是什么",
    expectedIds: ["scene:rain-bridge-blocking"],
  },
  {
    caseId: "shot-lens-recall",
    domain: "shot",
    query: "雨夜天桥镜头应该用什么镜头语言压缩空间",
    expectedIds: ["shot:rain-bridge-telephoto"],
  },
  {
    caseId: "asset-continuity-recall",
    domain: "asset",
    query: "红伞这个关键道具的连续性要求是什么",
    expectedIds: ["asset:red-umbrella"],
  },
  {
    caseId: "decision-rationale-recall",
    domain: "decision",
    query: "为什么要保留雨声环境音",
    expectedIds: ["decision:keep-rain-ambience"],
  },
  {
    caseId: "evidence-source-recall",
    domain: "evidence",
    query: "六宫格设计方法来自哪条网页证据",
    expectedIds: ["evidence:weixin-six-grid-design"],
  },
] as const satisfies readonly Omit<
  ConversationRuntimeMemoryRecallBenchmarkCase,
  "retrieved" | "k"
>[];

export function createDirectorMemoryRecallBenchmarkFixture(
  input: CreateDirectorMemoryRecallBenchmarkFixtureInput = {},
): ConversationRuntimeMemoryRecallBenchmarkSuite {
  return {
    schemaVersion: "conversation-runtime.memory-recall-benchmark-suite.v1",
    suiteId: input.suiteId ?? "director-memory-planted-needle.v1",
    cases: DIRECTOR_MEMORY_RECALL_FIXTURE_CASES.map((fixtureCase) => ({
      ...fixtureCase,
      k: normalizeK(input.k, 3),
      retrieved: addDefaultLatency(
        input.retrievedByCaseId?.[fixtureCase.caseId] ?? [],
        input.defaultLatencyMs,
      ),
    })),
    metadata: {
      fixtureKind: "director-domain-planted-needle",
      domainCoverage: DIRECTOR_MEMORY_RECALL_FIXTURE_CASES.map((fixtureCase) => fixtureCase.domain),
    },
  };
}

export function evaluateConversationRuntimeMemoryRecallBenchmark(
  suite: ConversationRuntimeMemoryRecallBenchmarkSuite,
  options: EvaluateConversationRuntimeMemoryRecallBenchmarkOptions = {},
): ConversationRuntimeMemoryRecallBenchmarkReport {
  const selectedCaseIds =
    options.caseIds === undefined ? undefined : new Set(options.caseIds.filter(Boolean));
  const cases =
    selectedCaseIds === undefined
      ? suite.cases
      : suite.cases.filter((item) => selectedCaseIds.has(item.caseId));
  const results = cases.map((item) =>
    evaluateConversationRuntimeMemoryRecallBenchmarkCase(item, options),
  );
  const failures = results.flatMap((result) => createBenchmarkFailures(result));

  return {
    schemaVersion: "conversation-runtime.memory-recall-benchmark.v1",
    suiteId: suite.suiteId,
    caseCount: results.length,
    passed: failures.length === 0,
    metrics: {
      recallAtK: averageMetric(results.map((item) => item.recallAtK)),
      recallAnyAtK: averageMetric(results.map((item) => item.recallAnyAtK)),
      recallAllAtK: averageMetric(results.map((item) => item.recallAllAtK)),
      ndcgAtK: averageMetric(results.map((item) => item.ndcgAtK)),
      provenanceCompleteness: averageMetric(results.map((item) => item.provenanceCompleteness)),
      averageLatencyMs: averageMetric(results.map((item) => item.latencyMs)),
      p95LatencyMs: percentileMetric(
        results.map((item) => item.latencyMs),
        0.95,
      ),
    },
    results,
    failures,
  };
}

function evaluateConversationRuntimeMemoryRecallBenchmarkCase(
  benchmarkCase: ConversationRuntimeMemoryRecallBenchmarkCase,
  options: EvaluateConversationRuntimeMemoryRecallBenchmarkOptions,
): ConversationRuntimeMemoryRecallBenchmarkCaseResult {
  const expectedIds = dedupeIds(benchmarkCase.expectedIds);
  const k = normalizeK(benchmarkCase.k ?? options.defaultK, benchmarkCase.retrieved.length);
  const retrievedHitsAtK = benchmarkCase.retrieved
    .filter((hit) => hit.status === undefined || hit.status === "hit")
    .slice(0, k);
  const retrievedIdsAtK = dedupeIds(
    retrievedHitsAtK
      .map((hit) => hit.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const expectedSet = new Set(expectedIds);
  const foundExpectedIds = retrievedIdsAtK.filter((id) => expectedSet.has(id));
  const foundSet = new Set(foundExpectedIds);
  const missingExpectedIds = expectedIds.filter((id) => !foundSet.has(id));
  const missingProvenanceHitIds = retrievedHitsAtK
    .filter((hit) => !hasRequiredProvenance(hit, options))
    .map((hit) => hit.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const expectedCount = expectedIds.length;
  const foundCount = foundExpectedIds.length;

  return {
    caseId: benchmarkCase.caseId,
    domain: benchmarkCase.domain,
    query: benchmarkCase.query,
    k,
    expectedCount,
    hitCount: benchmarkCase.retrieved.length,
    foundCount,
    recallAtK: roundMetric(expectedCount === 0 ? 1 : foundCount / expectedCount),
    recallAnyAtK: expectedCount === 0 || foundCount > 0 ? 1 : 0,
    recallAllAtK: expectedCount === 0 || foundCount === expectedCount ? 1 : 0,
    ndcgAtK: roundMetric(computeNdcgAtK(retrievedIdsAtK, expectedSet, k, expectedCount)),
    provenanceCompleteness: roundMetric(
      retrievedHitsAtK.length === 0
        ? 1
        : (retrievedHitsAtK.length - missingProvenanceHitIds.length) / retrievedHitsAtK.length,
    ),
    latencyMs: averageMetric(
      retrievedHitsAtK
        .map((hit) => hit.latencyMs)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
    retrievedIdsAtK,
    foundExpectedIds,
    missingExpectedIds,
    missingProvenanceHitIds,
  };
}

function createBenchmarkFailures(
  result: ConversationRuntimeMemoryRecallBenchmarkCaseResult,
): readonly ConversationRuntimeMemoryRecallBenchmarkFailure[] {
  const failures: ConversationRuntimeMemoryRecallBenchmarkFailure[] = [];
  if (result.missingExpectedIds.length > 0) {
    failures.push({
      caseId: result.caseId,
      domain: result.domain,
      type: "missing-expected-ids",
      missingExpectedIds: result.missingExpectedIds,
    });
  }
  if (result.missingProvenanceHitIds.length > 0) {
    failures.push({
      caseId: result.caseId,
      domain: result.domain,
      type: "missing-provenance",
      missingProvenanceHitIds: result.missingProvenanceHitIds,
    });
  }
  return failures;
}

function addDefaultLatency(
  hits: readonly ConversationRuntimeMemoryRecallBenchmarkHit[],
  defaultLatencyMs: number | undefined,
): readonly ConversationRuntimeMemoryRecallBenchmarkHit[] {
  if (defaultLatencyMs === undefined) {
    return hits;
  }
  return hits.map((hit) => ({
    ...hit,
    latencyMs: hit.latencyMs ?? defaultLatencyMs,
  }));
}

function hasRequiredProvenance(
  hit: ConversationRuntimeMemoryRecallBenchmarkHit,
  options: EvaluateConversationRuntimeMemoryRecallBenchmarkOptions,
): boolean {
  const requireEvidenceRefs = options.requireEvidenceRefs ?? true;
  const requireSourceRefs = options.requireSourceRefs ?? true;
  const requirePolicyEnvelopeRefs = options.requirePolicyEnvelopeRefs ?? true;
  const provenance = hit.provenance;
  if (provenance === undefined) {
    return false;
  }
  return (
    (!requireEvidenceRefs || hasNonEmptyValues(provenance.evidenceRefIds)) &&
    (!requireSourceRefs || hasNonEmptyValues(provenance.sourceRefs)) &&
    (!requirePolicyEnvelopeRefs || hasNonEmptyValues(provenance.policyEnvelopeRefs))
  );
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
  const idealLength = Math.min(k, expectedCount);
  const idealDcg = computeDcg(Array.from({ length: idealLength }, () => 1));
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function computeDcg(relevances: readonly number[]): number {
  return relevances.reduce((total, relevance, index) => {
    return total + relevance / Math.log2(index + 2);
  }, 0);
}

function normalizeK(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(1, fallback);
  }
  return Math.max(1, Math.trunc(value));
}

function dedupeIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function hasNonEmptyValues(values: readonly string[] | undefined): boolean {
  return values?.some((value) => value.trim().length > 0) ?? false;
}

function averageMetric(values: readonly number[]): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return 0;
  }
  return roundMetric(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length);
}

function percentileMetric(values: readonly number[], percentile: number): number {
  const finiteValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finiteValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    finiteValues.length - 1,
    Math.max(0, Math.ceil(finiteValues.length * percentile) - 1),
  );
  return roundMetric(finiteValues[index] ?? 0);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
