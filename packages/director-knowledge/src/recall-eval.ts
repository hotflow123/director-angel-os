export interface DirectorRecallTraceEvalHit {
  readonly id?: string;
  readonly source?: string;
  readonly status?: string;
  readonly score?: number;
}

export interface DirectorRecallTracePacketLike {
  readonly recallTrace?: readonly DirectorRecallTraceEvalHit[];
  readonly knowledgeHits?: readonly {
    readonly id?: string;
    readonly knowledgePackId?: string;
    readonly score?: number;
  }[];
  readonly skillHits?: readonly {
    readonly id?: string;
    readonly skillId?: string;
    readonly score?: number;
  }[];
  readonly hits?: readonly DirectorRecallTraceEvalHit[];
}

export interface EvaluateDirectorRecallTraceInput {
  readonly queryId: string;
  readonly expectedIds: readonly string[];
  readonly hits: readonly DirectorRecallTraceEvalHit[];
  readonly k?: number;
}

export interface DirectorRecallTraceEvalResult {
  readonly queryId: string;
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
}

export interface DirectorRecallTraceEvalSuiteResult {
  readonly caseCount: number;
  readonly averages: {
    readonly recallAtK: number;
    readonly recallAnyAtK: number;
    readonly recallAllAtK: number;
    readonly ndcgAtK: number;
  };
  readonly results: readonly DirectorRecallTraceEvalResult[];
  readonly failures: readonly {
    readonly queryId: string;
    readonly missingExpectedIds: readonly string[];
  }[];
}

export function evaluateDirectorRecallTrace(
  input: EvaluateDirectorRecallTraceInput,
): DirectorRecallTraceEvalResult {
  const expectedIds = dedupeIds(input.expectedIds);
  const k = normalizeK(input.k, input.hits.length);
  const retrievedIdsAtK = dedupeIds(
    input.hits
      .filter((hit) => hit.status === undefined || hit.status === "hit")
      .slice(0, k)
      .map((hit) => hit.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const expectedSet = new Set(expectedIds);
  const foundExpectedIds = retrievedIdsAtK.filter((id) => expectedSet.has(id));
  const foundSet = new Set(foundExpectedIds);
  const missingExpectedIds = expectedIds.filter((id) => !foundSet.has(id));
  const expectedCount = expectedIds.length;
  const foundCount = foundExpectedIds.length;
  const recallAtK = expectedCount === 0 ? 1 : foundCount / expectedCount;

  return {
    queryId: input.queryId,
    k,
    expectedCount,
    hitCount: input.hits.length,
    foundCount,
    recallAtK: roundMetric(recallAtK),
    recallAnyAtK: expectedCount === 0 || foundCount > 0 ? 1 : 0,
    recallAllAtK: expectedCount === 0 || foundCount === expectedCount ? 1 : 0,
    ndcgAtK: roundMetric(computeNdcgAtK(retrievedIdsAtK, expectedSet, k, expectedCount)),
    retrievedIdsAtK,
    foundExpectedIds,
    missingExpectedIds,
  };
}

export function evaluateDirectorRecallTraceSuite(
  cases: readonly EvaluateDirectorRecallTraceInput[],
): DirectorRecallTraceEvalSuiteResult {
  const results = cases.map((item) => evaluateDirectorRecallTrace(item));
  return {
    caseCount: results.length,
    averages: {
      recallAtK: averageMetric(results.map((item) => item.recallAtK)),
      recallAnyAtK: averageMetric(results.map((item) => item.recallAnyAtK)),
      recallAllAtK: averageMetric(results.map((item) => item.recallAllAtK)),
      ndcgAtK: averageMetric(results.map((item) => item.ndcgAtK)),
    },
    results,
    failures: results
      .filter((item) => item.missingExpectedIds.length > 0)
      .map((item) => ({
        queryId: item.queryId,
        missingExpectedIds: item.missingExpectedIds,
      })),
  };
}

export function evaluateDirectorRecallPacket(input: {
  readonly queryId: string;
  readonly expectedIds: readonly string[];
  readonly packet: DirectorRecallTracePacketLike;
  readonly k?: number;
}): DirectorRecallTraceEvalResult {
  return evaluateDirectorRecallTrace({
    queryId: input.queryId,
    expectedIds: input.expectedIds,
    hits: extractDirectorRecallEvalHits(input.packet),
    ...(input.k === undefined ? {} : { k: input.k }),
  });
}

export function extractDirectorRecallEvalHits(
  packet: DirectorRecallTracePacketLike,
): readonly DirectorRecallTraceEvalHit[] {
  const hits: DirectorRecallTraceEvalHit[] = [];
  for (const trace of packet.recallTrace ?? []) {
    hits.push({
      ...(trace.id === undefined ? {} : { id: trace.id }),
      ...(trace.source === undefined ? {} : { source: trace.source }),
      ...(trace.status === undefined ? {} : { status: trace.status }),
      ...(trace.score === undefined ? {} : { score: trace.score }),
    });
  }
  for (const hit of packet.knowledgeHits ?? []) {
    const id = hit.id ?? hit.knowledgePackId;
    hits.push({
      ...(id === undefined ? {} : { id: normalizeRecallEvalHitId("knowledge", id) }),
      source: "knowledge",
      status: "hit",
      ...(hit.score === undefined ? {} : { score: hit.score }),
    });
  }
  for (const hit of packet.skillHits ?? []) {
    const id = hit.id ?? hit.skillId;
    hits.push({
      ...(id === undefined ? {} : { id: normalizeRecallEvalHitId("skill", id) }),
      source: "skill",
      status: "hit",
      ...(hit.score === undefined ? {} : { score: hit.score }),
    });
  }
  for (const hit of packet.hits ?? []) {
    hits.push(hit);
  }
  return dedupeEvalHits(hits);
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

function normalizeK(value: number | undefined, hitCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(1, hitCount);
  }
  return Math.max(1, Math.trunc(value));
}

function dedupeIds(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function dedupeEvalHits(
  hits: readonly DirectorRecallTraceEvalHit[],
): readonly DirectorRecallTraceEvalHit[] {
  const seen = new Set<string>();
  const deduped: DirectorRecallTraceEvalHit[] = [];
  for (const hit of hits) {
    const key = `${hit.source ?? ""}:${hit.id ?? ""}:${hit.status ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(hit);
  }
  return deduped;
}

function normalizeRecallEvalHitId(source: "knowledge" | "skill", id: string): string {
  return id.startsWith(`${source}:`) ? id : `${source}:${id}`;
}

function averageMetric(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
