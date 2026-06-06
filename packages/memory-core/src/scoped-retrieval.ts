import type { Layer0MemoryStore } from "./layer0.js";
import type { Layer1MemoryStore } from "./layer1.js";
import type { MemoryHit, ScopedRetrieveOptions } from "./types.js";

export interface ScopedRetrieverDeps {
  layer0: Pick<Layer0MemoryStore, "retrieve">;
  layer1: Pick<Layer1MemoryStore, "retrieve">;
}

function dedupeHits(hits: MemoryHit[]): MemoryHit[] {
  const seen = new Set<string>();
  const deduped: MemoryHit[] = [];

  for (const hit of hits) {
    const key = `${hit.entry.layer}:${hit.entry.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(hit);
  }

  return deduped;
}

export function retrieveScopedMemory(
  deps: ScopedRetrieverDeps,
  options: ScopedRetrieveOptions,
): MemoryHit[] {
  const layers = options.layers ?? ["layer0", "layer1"];
  const limit = Math.max(1, options.limit ?? 10);
  const hits: MemoryHit[] = [];

  if (layers.includes("layer0")) {
    hits.push(...deps.layer0.retrieve({ ...options, limit }));
  }

  if (layers.includes("layer1")) {
    hits.push(...deps.layer1.retrieve({ ...options, limit }));
  }

  return dedupeHits(hits)
    .filter((hit) => isRecallableHit(hit, options))
    .sort((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, limit);
}

function isRecallableHit(hit: MemoryHit, options: ScopedRetrieveOptions): boolean {
  const requestedNamespace = options.scope.namespace;
  if (
    requestedNamespace === hit.entry.scope.namespace ||
    requestedNamespace === "memory:quarantine" ||
    requestedNamespace === "memory:discarded"
  ) {
    return true;
  }

  const admission = readMemoryAdmission(hit.entry.metadata);
  if (admission?.retention === "none" || admission?.retention === "quarantine") {
    return false;
  }

  return !hit.entry.tags.some((tag) => tag === "memory:quarantine" || tag === "memory:noise");
}

function readMemoryAdmission(
  metadata: Record<string, unknown>,
): { retention?: unknown } | undefined {
  const admission = metadata.memoryAdmission;
  if (typeof admission !== "object" || admission === null) {
    return undefined;
  }

  return admission as { retention?: unknown };
}
