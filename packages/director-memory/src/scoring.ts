import type { DirectorMemoryRecord, DirectorRecallQuery } from "@hotflow/director-memory-contracts";

export interface DirectorRecallScoringWeights {
  readonly projectIdMatch: number;
  readonly groupIdMatch: number;
  readonly anchorIdMatch: number;
  readonly selectedAdapterMatch: number;
  readonly generationTypeMatch: number;
  readonly generationStyleMatch: number;
  readonly knowledgeSignalTagMatch: number;
  readonly recencyMaxBoost: number;
  readonly recencyMaxAgeDays: number;
}

export interface DirectorRecallScore {
  readonly score: number;
  readonly reasons: readonly string[];
}

export const DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS: DirectorRecallScoringWeights = {
  projectIdMatch: 10,
  groupIdMatch: 5,
  anchorIdMatch: 3,
  selectedAdapterMatch: 4,
  generationTypeMatch: 2,
  generationStyleMatch: 2,
  knowledgeSignalTagMatch: 1,
  recencyMaxBoost: 3,
  recencyMaxAgeDays: 30,
};

export function scoreDirectorMemoryRecord(
  record: DirectorMemoryRecord,
  query: DirectorRecallQuery,
  options: {
    readonly now: string;
    readonly weights?: DirectorRecallScoringWeights;
  },
): DirectorRecallScore | null {
  if (record.projectId !== query.projectId) {
    return null;
  }

  const weights = options.weights ?? DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS;
  let score = weights.projectIdMatch;
  const reasons = ["projectId matched"];

  if (query.groupId !== undefined && record.groupId === query.groupId) {
    score += weights.groupIdMatch;
    reasons.push("groupId matched");
  }

  const anchorMatches = intersect(record.anchorIds, query.anchorIds ?? []);
  if (anchorMatches.length > 0) {
    score += anchorMatches.length * weights.anchorIdMatch;
    reasons.push(`${anchorMatches.length} anchorIds matched`);
  }

  const adapterMatches = intersect(record.selectedAdapters, query.selectedAdapters ?? []);
  if (adapterMatches.length > 0) {
    score += weights.selectedAdapterMatch;
    reasons.push("selectedAdapters matched");
  }

  if (
    query.generationType !== undefined &&
    record.digest.generationType !== undefined &&
    record.digest.generationType === query.generationType
  ) {
    score += weights.generationTypeMatch;
    reasons.push("generationType matched");
  }

  if (
    query.generationStyle !== undefined &&
    record.digest.generationStyle !== undefined &&
    record.digest.generationStyle === query.generationStyle
  ) {
    score += weights.generationStyleMatch;
    reasons.push("generationStyle matched");
  }

  const tagMatches = intersect(record.tags ?? [], query.knowledgeSignalTags ?? []);
  if (tagMatches.length > 0) {
    score += tagMatches.length * weights.knowledgeSignalTagMatch;
    reasons.push("knowledgeSignalTags matched");
  }

  const recencyBoost = computeRecencyBoost(record.recordedAt, options.now, weights);
  if (recencyBoost > 0) {
    score += recencyBoost;
    reasons.push("recency boosted");
  }

  return {
    score: Number(score.toFixed(6)),
    reasons,
  };
}

function computeRecencyBoost(
  recordedAt: string,
  now: string,
  weights: DirectorRecallScoringWeights,
): number {
  const recordedAtMs = Date.parse(recordedAt);
  const nowMs = Date.parse(now);

  if (!Number.isFinite(recordedAtMs) || !Number.isFinite(nowMs) || nowMs < recordedAtMs) {
    return 0;
  }

  const elapsedDays = (nowMs - recordedAtMs) / (1000 * 60 * 60 * 24);
  if (elapsedDays >= weights.recencyMaxAgeDays) {
    return 0;
  }

  const ratio = (weights.recencyMaxAgeDays - elapsedDays) / weights.recencyMaxAgeDays;
  return Number((ratio * weights.recencyMaxBoost).toFixed(6));
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
}
