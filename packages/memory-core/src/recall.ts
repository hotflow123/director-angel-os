import { type ScopedRetrieverDeps, retrieveScopedMemory } from "./scoped-retrieval.js";
import type { MemoryHit, MemoryRecallOptions } from "./types.js";

const DEFAULT_MIN_SCORE = Number.NEGATIVE_INFINITY;

export function filterRecallHits(
  hits: readonly MemoryHit[],
  minScore = DEFAULT_MIN_SCORE,
): MemoryHit[] {
  return hits.filter((hit) => hit.score >= minScore);
}

export function recallMemory(deps: ScopedRetrieverDeps, options: MemoryRecallOptions): MemoryHit[] {
  const hits = retrieveScopedMemory(deps, options);
  return filterRecallHits(hits, options.minScore ?? DEFAULT_MIN_SCORE);
}
